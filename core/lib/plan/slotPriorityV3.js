/** Pure bounded slot-priority pass, ported from the approved local v9 search. */
// Generic minimax objective includes glutes normally; no glute-specific tuning.
import { buildWeeklyTemplateV3 } from './weeklyTemplateV3.js';
import { allocateTemplateWeek } from './templateWeekAllocator.js';
import { allocateTemplateVolumeV3 } from './templateVolumeAllocatorV3.js';
import { repairThinSessionsV3, dayRegionV3, slotRegionV3 } from './sessionRepairV3.js';
import { buildVolumePrescriptionV3 } from './volumePrescriptionV3.js';
import { MAJOR_GROUPS, groupContributionFor, weeklyPrescribedGroupTotals } from './muscleVolumeGroups.js';
import { coverageCreditForSlot, evaluateWeeklyCoverage } from './weeklyCoverageV3.js';
import { slotRawSeconds, sessionRawSeconds, validateResolvedSlot } from './resolvedSlotContract.js';
import { validateRequiredExtensionV3, sessionEstimateV3, recoveryConflictsV3 } from './sessionBudgetV3.js';
import { resolveSlotCandidates } from './slotEligibility.js';
import { selectionPreferenceIndex } from './selectionPreference.js';

export const SLOT_PRIORITY_VERSION = 'slot-priority.v2';
import { getExerciseById } from '../../data/exerciseRegistryIndex.js';
const DEADLIFT_FAMILIES=new Set(['fam.deadlift_conventional','fam.deadlift_trapbar','fam.deadlift_romanian','fam.deadlift_sumo']);
const EPS = 60e-9;
const ok = (r) => { if (!r?.ok) throw Error(r?.reason || 'helper refused'); return r; };
const numeric = (r) => { if (typeof r !== 'number') throw Error(r?.reason || 'timing refused'); return r; };
const secondary = pattern => ({pattern,intent:'structural_secondary'});
const acc = accessoryKind => ({pattern:'ACC',intent:'accessory',accessoryKind});
const kinds = [...['SQ','HPU','HPL','HG','VPU','VPL','LU'].map(secondary),
  ...['ham_knee_flexion','lateral_delts','rear_delts','calves','biceps','triceps','glutes'].map(acc),
  {pattern:'CORE',intent:'core'}];
// Per-call caches are passed explicitly; no retained caller-owned state.

const signature = s => JSON.stringify(s);
function metadata(s, metadataCache) {
  const p=s.resolvedPrescription;
  const key=JSON.stringify([s.exerciseId,s.slotKind,p.goal,p.tier,s.mode,s.sets]);
  if(!metadataCache.has(key)) {
    const c=ok(groupContributionFor(s)), credit=ok(coverageCreditForSlot(s)).credits;
    const record=getExerciseById(s.exerciseId);
    if(!record?.primaryPattern||!record?.primaryFamilyId||!Array.isArray(record.componentFamilyIds))
      throw Error('STOP: registry pattern/family data missing; no name-based inference is allowed');
    const deadlift=[record.primaryFamilyId,...record.componentFamilyIds].some(f=>DEADLIFT_FAMILIES.has(f));
    metadataCache.set(key,{seconds:numeric(slotRawSeconds(s)),groups:c.groups,nativePattern:record.primaryPattern,deadlift,
      muscles:{...Object.fromEntries(Object.entries(c.diagnostics.muscleTotals).map(([k,v])=>['muscle:'+k,v])),
        ...Object.fromEntries(Object.entries(c.groups).map(([k,v])=>['group:'+k,v]))},credit});
  }
  return metadataCache.get(key);
}
function searchSlotPriority(original, context) {
  original = structuredClone(original);
  const metadataCache = new Map(), poolCache = new Map();
  const meta = slot => metadata(slot, metadataCache);
function ledger(w) {
  const totals={},muscles={},exposures={},direct={calves:0,lateral_delts:0};
  for(const d of w.days) {
    const seen=new Set();
    for(const s of d.slots) {
      const m=meta(s);
      for(const [g,v] of Object.entries(m.groups)) totals[g]=(totals[g]||0)+v;
      for(const [g,v] of Object.entries(m.muscles)) muscles[g]=(muscles[g]||0)+v;
      for(const [k,v] of Object.entries(m.credit)) if(v) seen.add(k);
      for(const g of ['calves','lateral_delts']) {
        const group=g==='lateral_delts'?'side_delts':g;
        if(s.slotKind.pattern==='ACC'&&s.slotKind.accessoryKind===g&&m.groups[group]===s.sets) direct[g]++;
      }
    }
    for(const k of seen) exposures[k]=(exposures[k]||0)+1;
  }
  return {totals,muscles,exposures,direct};
}
function pool(kind,context) {
  const mode=context.durationMinutes===15?'short_session':'standard';
  const key=JSON.stringify([kind,context.tier,context.goal,mode,context.equipmentContext]);
  if(!poolCache.has(key)) {
    const r=ok(resolveSlotCandidates({slotKind:kind,goal:context.goal,tier:context.tier,mode,
      athleteContext:context.equipmentContext,
      timingCheck:p=>validateResolvedSlot({exerciseId:p.exerciseId,slotKind:kind,mode,sets:p.sets.min,resolvedPrescription:p})}));
    const slots=r.candidates.map(c=>({...c,slotKind:kind,mode,sets:c.resolvedPrescription.sets.min,source:'optional_addition'}));
    slots.sort((a,b)=>selectionPreferenceIndex(kind,context.tier,a.exerciseId)-selectionPreferenceIndex(kind,context.tier,b.exerciseId)
      || (a.exerciseId<b.exerciseId?-1:a.exerciseId>b.exerciseId?1:0));
    poolCache.set(key,slots);
  }
  return poolCache.get(key);
}
const gcd=(a,b)=>b?gcd(b,a%b):a;

/** Local v9: all admissible receiver IDs and approved set counts are scored.
 * Mandatory inherited rule-7 corrections allow equal maximum deficit.
 * Optional transactions strictly lower (maximum deficit, sum of deficits).
 * Selection preference resolves objective ties; rule 9 is a commit veto.
 */

// Rule 6: authored template identity is the day authority. CORE is region-neutral;
// structural and accessory slots retain their authored upper/lower regions.
function regionFits(slot,authoredDay) {
  const day=dayRegionV3(authoredDay),region=slotRegionV3(slot);
  if(!day||!region)throw Error('STOP: unknown authored day/slot region');
  return day==='full'||region===day||region==='neutral';
}
const identity=s=>JSON.stringify([s.exerciseId,s.slotKind]);
function fillsFit(w,baseline,template) {
  return w.days.every((day,di)=>day.slots.every(s=>{
    const inherited=baseline.days[di].slots.some(old=>identity(old)===identity(s)&&old.sets===s.sets);
    return inherited||regionFits(s,template.days[di]);
  }));
}
// Canonical registry patterns count every exercise, including accessories.
// Authored movement keys additionally preserve VPL/CORE exposures even when
// native taxonomy splits CORE into core/rotation. ACC is not a movement key.
function exposureKeys(s) {
  return ['registry:'+meta(s).nativePattern,...(s.slotKind.pattern==='ACC'?[]:['slot:'+s.slotKind.pattern])];
}
function patternCounts(w) {
  const counts={};
  for(const d of w.days)for(const s of d.slots)for(const k of exposureKeys(s))counts[k]=(counts[k]||0)+1;
  return counts;
}
function soleExposure(s,counts) {return exposureKeys(s).some(k=>counts[k]===1);}
function dayLimits(day) {
  const patterns={};let deadlifts=0;
  for(const s of day.slots){const m=meta(s);patterns[m.nativePattern]=(patterns[m.nativePattern]||0)+1;deadlifts+=Number(m.deadlift);}
  return {deadlifts,patterns,severity:Math.max(0,deadlifts-1)+Object.values(patterns).reduce((n,c)=>n+Math.max(0,c-2),0)};
}
function limitSeverity(w) {return w.days.reduce((n,d)=>n+dayLimits(d).severity,0);}

  const duration=original.durationMinutes;
  const template=ok(buildWeeklyTemplateV3(context));
  const prescription=ok(buildVolumePrescriptionV3({goal:context.goal,tier:context.tier}));
  const before=ledger(original),coverage=ok(evaluateWeeklyCoverage(original,{durationMinutes:duration}));
  const required=Object.entries(coverage.requirements).filter(([,r])=>r.required)
    .map(([key,r])=>({key,floor:Math.min(r.target,r.achieved)}));
  const budget=ok(validateRequiredExtensionV3(original));
  const mandatoryDirect=Object.fromEntries(['calves','lateral_delts'].map(g=>[g,before.direct[g]>0?1:0]));
  const protectedDirect=s=>s.slotKind.pattern==='ACC'&&['calves','lateral_delts'].includes(s.slotKind.accessoryKind);
  const isVPU=s=>s.slotKind.pattern==='VPU';
  const originalPatterns=patternCounts(original),originalSlots=original.days.flatMap(d=>d.slots);
  const vpuOnlyKeys=new Set(Object.keys(originalPatterns).filter(k=>
    originalSlots.filter(s=>exposureKeys(s).includes(k)).every(isVPU)));
  const baselineSoleVPU=originalSlots.filter(s=>isVPU(s)&&soleExposure(s,originalPatterns));
  const isBaselineSoleVPU=s=>baselineSoleVPU.some(original=>signature(original)===signature(s));
  const structural=new Set(['SQ','HG','LU','HPU','HPL','VPU','VPL']);
  const frontMin=prescription.groups.front_delts.target.min;
  const frontSafe=l=>(l.totals.front_delts||0)>=frontMin;
  const patternsKept=(w,l)=>{
    const counts=patternCounts(w);
    return Object.keys(originalPatterns).every(k=>counts[k]>0||(vpuOnlyKeys.has(k)&&frontSafe(l)));
  };
  const positive=Object.entries(before.muscles).filter(([,v])=>v>0).map(([k])=>k);
  const selectedSeconds=duration*60;
  const warmup=original.days.map(d=>numeric(sessionRawSeconds(d,duration))-d.slots.reduce((n,s)=>n+meta(s).seconds,0));
  const seconds=(d,di)=>warmup[di]+d.slots.reduce((n,s)=>n+meta(s).seconds,0);
  const bounds=MAJOR_GROUPS.map(g=>prescription.groups[g].target.min*2);
  const denominator=bounds.reduce((a,b)=>a*b/gcd(a,b),1);
  const score=l=>{
    const ds=MAJOR_GROUPS.map((g,i)=>Math.max(0,bounds[i]-2*(l.totals[g]||0))*(denominator/bounds[i]));
    return {max:Math.max(...ds),sum:ds.reduce((a,b)=>a+b,0)};
  };
  const baselineScore=score(before);
  const missing=l=>Object.entries(mandatoryDirect).some(([g,min])=>l.direct[g]<min);
  const baselinePullGap=Math.max(0,(before.totals.chest||0)-(before.totals.back||0));
  const rule9=l=>Math.max(0,(l.totals.chest||0)-(l.totals.back||0))<=baselinePullGap;
  const noLoss=l=>required.every(r=>(l.exposures[r.key]||0)>=r.floor)
    &&positive.every(k=>(l.muscles[k]||0)>0)
    &&['calves','side_delts'].every(g=>(l.totals[g]||0)>=(before.totals[g]||0));
  // Rule 10: primary MAJOR means full 1.0 prescribed credit, not the
  // structural_primary slot intent. Every primary MAJOR must be nondeficient.
  const deficitDonor=(s,l)=>MAJOR_GROUPS.some(g=>meta(s).groups[g]===s.sets
    &&(l.totals[g]||0)<prescription.groups[g].target.min);
  const pins=original.days.map((d,di)=>d.slots.filter((s,si)=>{
    const sole=soleExposure(s,originalPatterns),vpuException=sole&&isVPU(s);
    if((sole&&!vpuException)||protectedDirect(s)
      ||(s.slotKind.intent==='structural_primary'&&!vpuException)
      ||s.requiredCoveragePlacement||budget.extendedTemplateIds.includes(d.templateId))return true;
    // The VPU exception never waives REQUIRED coverage or extension proof.
    const w={...original,days:original.days.map((day,i)=>i===di?{...day,slots:day.slots.filter((_,j)=>j!==si)}:day)};
    return !required.every(r=>(ledger(w).exposures[r.key]||0)>=r.floor);
  }));
  const pinnedSignatures=pins.map(ss=>ss.map(signature));
  const pinsKept=w=>pinnedSignatures.every((ss,di)=>ss.every(sig=>w.days[di].slots.some(s=>signature(s)===sig)));
  let week={...original,days:original.days.map(d=>({...d,slots:[...d.slots]}))};
  let transactions=0,capped=false,mandatoryRepairs=0,rule9Vetoes=0;
  const coachingTransitions=[];
  const removedStructural=original.days.map(()=>new Set());
  const isPower=s=>(getExerciseById(s.exerciseId)?.intentTags??[]).includes('power');

  const kindOrder=s=>s?kinds.findIndex(k=>JSON.stringify(k)===JSON.stringify(s.slotKind)):-1;
  function compare(a,b) {
    return compareSlotPriorityChoicesV3(a,b);
  }

  function dayOptions(tier,repairLimits) {
    const state=ledger(week),oldScore=score(state),oldSeverity=limitSeverity(week),counts=patternCounts(week);
    const bestByDay=new Map();
    for(const [di,day]of week.days.entries()) {
      if(budget.extendedTemplateIds.includes(day.templateId))continue;
      const mutable=day.slots.filter(s=>!pins[di].includes(s)&&!protectedDirect(s)
        &&(!soleExposure(s,counts)||isVPU(s))&&!deficitDonor(s,state));
      const arms=mutable.filter(s=>s.slotKind.pattern==='ACC'&&['biceps','triceps'].includes(s.slotKind.accessoryKind));
      const others=mutable.filter(s=>!arms.includes(s));
      function offer(outgoing,incoming,donors,growth=false) {
        // Rule 11 compares the incoming structural slot with the entire
        // pre-transaction day, including donors. Set growth is not a new slot.
        if(!repairLimits&&!growth&&incoming&&structural.has(incoming.slotKind.pattern)
          &&(day.slots.some(s=>s.slotKind.pattern===incoming.slotKind.pattern)||removedStructural[di].has(incoming.slotKind.pattern)))return;
        if(donors.some(s=>deficitDonor(s,state)))return;
        if(donors.some(s=>soleExposure(s,counts)&&!isVPU(s)))return;
        const projected={...state.totals};
        for(const s of outgoing)for(const [g,n]of Object.entries(meta(s).groups))projected[g]=(projected[g]||0)-n;
        if(incoming)for(const [g,n]of Object.entries(meta(incoming).groups))projected[g]=(projected[g]||0)+n;
        const sc=score({totals:projected});
        if(sc.max>baselineScore.max||sc.max>oldScore.max)return;
        if(!acceptSlotPriorityScoreV3(oldScore,sc,repairLimits?'mandatory_rule7':'optional'))return;
        if(donors.some(s=>isVPU(s)&&(soleExposure(s,counts)||isBaselineSoleVPU(s)))&&(projected.front_delts||0)<frontMin)return;
        if(['calves','side_delts'].some(g=>(projected[g]||0)<(before.totals[g]||0)))return;
        if(repairLimits&&(donors.length!==1||outgoing.length!==1||!incoming
          ||JSON.stringify(incoming.slotKind)!==JSON.stringify(outgoing[0].slotKind)
          ||incoming.templateSlotIndex!==outgoing[0].templateSlotIndex))return;
        let slots;
        if(repairLimits)slots=day.slots.map(s=>s===outgoing[0]?incoming:s);
        else if(growth)slots=day.slots.map(s=>s===outgoing[0]?incoming:s);
        else slots=[...day.slots.filter(s=>!outgoing.includes(s)),...(incoming?[incoming]:[])];
        const proposedDay={...day,slots};
        if(slots.length<2||seconds(proposedDay,di)>selectedSeconds+EPS)return;
        if(new Set(slots.map(s=>s.exerciseId)).size!==slots.length)return;
        const severity=oldSeverity-dayLimits(day).severity+dayLimits(proposedDay).severity;
        if(repairLimits?severity>=oldSeverity:severity!==0)return;
        const pick={score:sc,di,donors,receiver:incoming,severity,repairPower:Number(repairLimits&&context.goal==='muscle_gain'&&isPower(incoming)),
          kindRank:kindOrder(incoming),preference:incoming?selectionPreferenceIndex(incoming.slotKind,context.tier,incoming.exerciseId):-1,
          receiverId:incoming?.exerciseId??'',phase:repairLimits?'mandatory_rule7':'optional'};
        const best=bestByDay.get(di);
        // Objective bound only: a pair unable to beat an already-validated
        // daily winner cannot affect the result. No first-admissible shortcut.
        if(best&&compare(pick,best)>=0)return;
        const w={...week,days:week.days.map((d,i)=>i===di?proposedDay:d)},l=ledger(w);
        if(!noLoss(l)||missing(l)||!pinsKept(w)||!fillsFit(w,original,template)||!patternsKept(w,l)||(repairLimits&&!rule9(l)))return;
        pick.week=w;pick.ledger=l;bestByDay.set(di,pick);
      }
      if(repairLimits) {
        // Mandatory repair is exactly one replacement in its existing position.
        // Preserve authored slotKind/index (including an unindexed optional slot).
        for(const donor of tier===0?arms:others) {
          for(const candidate of pool(donor.slotKind,context)) {
            if(candidate.exerciseId===donor.exerciseId||!regionFits(candidate,template.days[di])
              ||day.slots.some(s=>s!==donor&&s.exerciseId===candidate.exerciseId))continue;
            for(let n=candidate.resolvedPrescription.sets.min;n<=candidate.resolvedPrescription.sets.max;n++) {
              const replacement={...donor,...candidate,slotKind:donor.slotKind,source:donor.source,sets:n};
              offer([donor],replacement,[donor]);
            }
          }
        }
        continue;
      }
      const bundles=[];
      if(tier===0) {
        bundles.push([]);
        for(let i=0;i<arms.length;i++) {
          bundles.push([arms[i]]);
          for(let j=i+1;j<arms.length;j++)bundles.push([arms[i],arms[j]]);
        }
        if(!repairLimits&&duration!==15)for(const s of mutable) {
          if(s.sets<s.resolvedPrescription.sets.max)offer([s],{...s,sets:s.sets+1},[],true);
        }
      } else {
        // Every single non-arm donor is scored. Existing bounded arm bundles
        // are additionally allowed; arms-only winners keep first priority.
        for(const s of others) {
          bundles.push([s]);
          if(arms.length)bundles.push([...arms,s]);
        }
      }
      for(const donation of bundles) {
        const kept=day.slots.filter(s=>!donation.includes(s));
        if(kept.length+1<2)continue;
        if(repairLimits&&donation.length&&kept.length>=2)offer(donation,null,donation);
        for(const kind of kinds)for(const candidate of pool(kind,context)) {
          if(kept.some(s=>s.exerciseId===candidate.exerciseId)||!regionFits(candidate,template.days[di]))continue;
          for(let n=candidate.resolvedPrescription.sets.min;n<=candidate.resolvedPrescription.sets.max;n++) {
            const slot={...candidate,sets:n},m=meta(slot);
            if(!repairLimits&&!MAJOR_GROUPS.some((g,i)=>(state.totals[g]||0)<bounds[i]/2&&m.groups[g]>0))continue;
            if(warmup[di]+kept.reduce((sum,s)=>sum+meta(s).seconds,0)+m.seconds>selectedSeconds+EPS)continue;
            offer(donation,slot,donation);
          }
        }
      }
    }
    return bestByDay;
  }

  function choose(repairLimits) {
    const arms=dayOptions(0,repairLimits),other=dayOptions(1,repairLimits),daily=[];
    for(let di=0;di<week.days.length;di++) {
      const a=arms.get(di),b=other.get(di);
      const pick=chooseSlotPriorityDonorTierV3(a,b,repairLimits);
      if(pick)daily.push(pick);
    }
    daily.sort(compare);
    // Rule 9 is a final gate on the chosen daily winner, not a receiver
    // scoring objective. A veto leaves that day unchanged; no lower-credit
    // receiver is substituted merely to satisfy a chest/back equality.
    for(const pick of daily) {
      if(rule9(pick.ledger))return pick;
      rule9Vetoes++;
    }
    return null;
  }
  const accept=pick=>{
    if(pick.phase==='optional')for(const donor of pick.donors) {
      if(structural.has(donor.slotKind.pattern))removedStructural[pick.di].add(donor.slotKind.pattern);
    }
    coachingTransitions.push({before:week,after:pick.week,dayIndex:pick.di,donors:pick.donors,receiver:pick.receiver,phase:pick.phase});
    week=pick.week;transactions++;if(pick.phase==='mandatory_rule7')mandatoryRepairs++;
  };
  for(let n=0;n<8&&limitSeverity(week)>0;n++) {
    const pick=choose(true);
    if(!pick)break;
    accept(pick);
  }
  for(let n=0;n<16;n++) {
    const pick=choose(false);
    if(!pick)break;
    accept(pick);if(n===15)capped=true;
  }
  week = structuredClone(week);
  for (const day of week.days) {
    day.rawSeconds = numeric(sessionRawSeconds(day, duration));
    if (week.requiredTimeExtension) day.timing = sessionEstimateV3(day, duration);
  }
  const assess = candidate => {
    const l = ledger(candidate);
    const codes = [];
    if (!noLoss(l) || missing(l) || !pinsKept(candidate) || !patternsKept(candidate,l)
        || !rule9(l) || score(l).max > baselineScore.max
        || (!frontSafe(l) && baselineSoleVPU.some(s => !candidate.days.some(d => d.slots.some(t => signature(t) === signature(s))))))
      codes.push({ code: 'SLOT_PRIORITY_PROTECTED_REGRESSION', details: {
        required: required.filter(r => (l.exposures[r.key] || 0) < r.floor)
          .map(r => ({ ...r, achieved: l.exposures[r.key] || 0 })),
        zeroed: positive.filter(k => !(l.muscles[k] > 0)),
        creditLoss: ['calves','side_delts'].filter(g => (l.totals[g] || 0) < (before.totals[g] || 0))
          .map(group => ({ group, before: before.totals[group], after: l.totals[group] || 0 })),
        directLoss: Object.entries(mandatoryDirect).filter(([g,min]) => l.direct[g] < min).map(([g]) => g),
        missingPins: pins.flatMap((ss,dayIndex) => ss.filter(s => !candidate.days[dayIndex].slots.some(t => signature(t) === signature(s)))
          .map(slot => ({ dayIndex, slot: structuredClone(slot) }))),
        lostPatterns: Object.keys(originalPatterns).filter(k => !patternCounts(candidate)[k] && !(vpuOnlyKeys.has(k) && frontSafe(l))),
        pullGap: Math.max(0,(l.totals.chest || 0)-(l.totals.back || 0)), baselinePullGap,
        maximumDeficit: score(l).max, baselineMaximumDeficit: baselineScore.max,
        lostSoleVpu: frontSafe(l) ? [] : baselineSoleVPU.filter(s => !candidate.days.some(d => d.slots.some(t => signature(t) === signature(s)))),
      } });
    // Only an unchanged inherited slot is exempt from the rule-6 fill restriction.
    for (const [dayIndex, day] of candidate.days.entries()) {
      for (const [slotIndex, slot] of day.slots.entries()) {
        const inherited = original.days[dayIndex].slots.some(old => identity(old) === identity(slot) && old.sets === slot.sets);
        if (!inherited && !regionFits(slot,template.days[dayIndex]))
          codes.push({ code: 'SLOT_PRIORITY_RULE6_REGION', dayIndex, slot: structuredClone(slot) });
      }
      const limits = dayLimits(day);
      if (limits.severity) codes.push({ code: 'SLOT_PRIORITY_RULE7_LIMITS', dayIndex,
        deadlifts: limits.deadlifts, patterns: limits.patterns });
    }
    if (recoveryConflictsV3(candidate) > recoveryConflictsV3(original))
      codes.push({ code: 'SLOT_PRIORITY_RECOVERY_REGRESSION' });
    return codes;
  };
  return { week, coachingTransitions, transactions, capped, mandatoryRepairs, rule9Vetoes, assess };
}

const failure = (reason = 'INVALID_SLOT_PRIORITY_PROOF', reasons = []) => ({ ok: false, reason, reasons });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const equal = (a,b) => canonical(a) === canonical(b);
const contextOf = week => ({ daysPerWeek: week.days.length, durationMinutes: week.durationMinutes,
  tier: week.tier, goal: week.equipmentContext.goal, equipmentContext: structuredClone(week.equipmentContext) });
const transactionOf = transition => ({ phase: transition.phase, dayIndex: transition.dayIndex,
  donors: structuredClone(transition.donors), receiver: structuredClone(transition.receiver),
  beforeSlots: structuredClone(transition.before.days[transition.dayIndex].slots),
  afterSlots: structuredClone(transition.after.days[transition.dayIndex].slots) });
const cleanWeek = week => {
  const result = structuredClone(week);
  delete result.slotPriority;
  delete result.slotPriorityRequired;
  return result;
};
// 2k may move whole slots, adding movedFrom; it may not change their dose or identity.
const packets = week => week.days.flatMap(day => day.slots.map(slot => {
  const result = structuredClone(slot); delete result.movedFrom; return canonical(result);
})).sort();

/** The only allocator call here reconstructs the pre-pass baseline for proof verification.
 * It never substitutes an optimizer result for the recorded transaction replay.
 */
function rebuildBaseline(context, priorityMuscles) {
  const template = ok(buildWeeklyTemplateV3(context));
  const allocation = ok(allocateTemplateWeek({ template, athleteContext: context.equipmentContext,
    ...context, recentIds: [] }));
  return ok(allocateTemplateVolumeV3({ week: allocation.week, priorityMuscles, deload: false })).week;
}

/** Bounded v9 search on 2j output, before whole-slot move repair. No caller mutation. */
export function applySlotPriorityV3({ week, priorityMuscles = [] } = {}) {
  try {
    if (!plain(week) || !Array.isArray(week.days) || week.slotPriority !== undefined
        || week.slotPriorityRequired !== undefined || !Array.isArray(priorityMuscles)) return failure('INVALID_SLOT_PRIORITY_INPUT');
    const baseline = structuredClone(week), context = contextOf(baseline);
    const result = searchSlotPriority(baseline, context);
    const reasons = result.assess(result.week);
    if (reasons.length) return failure(reasons[0].code, reasons);
    const proof = { version: SLOT_PRIORITY_VERSION, baseline, priorityMuscles: [...priorityMuscles],
      transactions: result.coachingTransitions.map(transactionOf) };
    const totals = ok(weeklyPrescribedGroupTotals(result.week)).totals;
    const rx = ok(buildVolumePrescriptionV3({ goal: context.goal, tier: context.tier }));
    const shortfalls = MAJOR_GROUPS.filter(group => totals[group] < rx.groups[group].target.min)
      .map(group => ({ group, prescribed: totals[group], lowerBound: rx.groups[group].target.min }));
    return { ok: true, week: { ...result.week, slotPriorityRequired: SLOT_PRIORITY_VERSION, slotPriority: proof },
      notes: shortfalls.length && ['muscle_gain','fat_loss'].includes(context.goal)
        ? [{ type: 'soft_volume_shortfall', groups: shortfalls }] : [],
      transactions: result.transactions, mandatoryRepairs: result.mandatoryRepairs,
      capped: result.capped, rule9Vetoes: result.rule9Vetoes };
  } catch (error) { return failure('SLOT_PRIORITY_ERROR', [{ code: 'SLOT_PRIORITY_ERROR', detail: error.message }]); }
}

/** Each invocation rebuilds the input from core authorities, then replays the bounded
 * deterministic search and compares every recorded donor, receiver and packet. No
 * cached verdict, claimed score, supplied budget, or producer success flag is trusted.
 * Arms-first selection and the non-power repair preference are re-enumerated too.
 * expectedBaseline anchors final delivery to the actual 2j stage, including priority.
 */
export function validateSlotPriorityV3(week, { expectedBaseline, required = false, final = false } = {}) {
  try {
    if (!plain(week) || !Array.isArray(week.days)) return failure();
    const proof = week.slotPriority;
    if (proof === undefined) return required || week.slotPriorityRequired !== undefined
      ? failure('MISSING_SLOT_PRIORITY_PROOF') : { ok: true };
    if (week.slotPriorityRequired !== SLOT_PRIORITY_VERSION || !plain(proof)
        || Object.keys(proof).sort().join(',') !== 'baseline,priorityMuscles,transactions,version'
        || proof.version !== SLOT_PRIORITY_VERSION || !Array.isArray(proof.transactions)
        || proof.transactions.length > 24 || !Array.isArray(proof.priorityMuscles)
        || !plain(proof.baseline) || proof.baseline.slotPriority !== undefined
        || proof.baseline.slotPriorityRequired !== undefined) return failure();
    const baseline = proof.baseline, context = contextOf(baseline);
    if (expectedBaseline && !equal(baseline,expectedBaseline)) return failure('SLOT_PRIORITY_BASELINE_MISMATCH');
    if (!equal(baseline,rebuildBaseline(context,proof.priorityMuscles))) return failure('SLOT_PRIORITY_BASELINE_MISMATCH');
    const expected = searchSlotPriority(baseline,context);
    if (!equal(proof.transactions,expected.coachingTransitions.map(transactionOf))) return failure('SLOT_PRIORITY_REPLAY_MISMATCH');
    const replay = structuredClone(baseline);
    const removed = replay.days.map(() => []);
    for (const entry of proof.transactions) {
      if (!Number.isInteger(entry.dayIndex) || !replay.days[entry.dayIndex]
          || !equal(replay.days[entry.dayIndex].slots,entry.beforeSlots)) return failure('SLOT_PRIORITY_REPLAY_MISMATCH');
      const before = structuredClone(replay);
      replay.days[entry.dayIndex].slots = structuredClone(entry.afterSlots);
      const audit = auditSlotPriorityTransactionV3({ baseline, before, after: replay, ...entry,
        removedStructural: removed[entry.dayIndex] });
      if (!audit.ok) return failure('SLOT_PRIORITY_TRANSACTION_INVALID',audit.reasons);
      if (entry.phase === 'optional') removed[entry.dayIndex].push(...entry.donors.map(s => s.slotKind.pattern));
    }
    if (!equal(replay.days.map(day => day.slots),expected.week.days.map(day => day.slots))) return failure('SLOT_PRIORITY_REPLAY_MISMATCH');
    const actual = cleanWeek(week);
    if (!equal(contextOf(actual),context) || !equal(actual.requiredTimeExtension,baseline.requiredTimeExtension)
        || !equal(actual.days.map(day => [day.templateId,day.baseTemplateId]),baseline.days.map(day => [day.templateId,day.baseTemplateId]))
        || !equal(packets(actual),packets(expected.week))) return failure('SLOT_PRIORITY_OUTPUT_MISMATCH');
    const reasons = expected.assess(actual);
    let reportOnly = [];
    if (final) {
      // Reconstruct the old 2j -> 2k path on demand. Its baseline has no
      // slot-priority proof, so this cannot recurse through proof validation.
      const prePortIssues = reasons.some(r => ['SLOT_PRIORITY_RULE6_REGION','SLOT_PRIORITY_PROTECTED_REGRESSION'].includes(r.code))
        ? expected.assess(ok(repairThinSessionsV3(baseline)).week) : [];
      const boundary = validateSlotPriority2kBoundaryV3({ issues: reasons, prePortIssues,
        expectedWeek: expected.week, actualWeek: actual, transactions: proof.transactions });
      if (!boundary.ok) return failure(boundary.reasons[0].code,boundary.reasons);
      reportOnly = boundary.reportOnly;
    } else if (reasons.length) return failure(reasons[0].code,reasons);
    // Before 2k all slot positions must match. At final delivery 2k may only move
    // complete packets, subject to the independently recomputed rules above.
    if (!final && !equal(actual.days.map(day => day.slots),expected.week.days.map(day => day.slots)))
      return failure('SLOT_PRIORITY_OUTPUT_MISMATCH');
    return { ok: true, transactions: proof.transactions.length, mandatoryRepairs: expected.mandatoryRepairs,
      diagnostics: { preExisting2kRegion: reportOnly.filter(r => r.code === 'SLOT_PRIORITY_RULE6_REGION'),
        preExisting2kProtected: reportOnly.filter(r => r.code === 'SLOT_PRIORITY_PROTECTED_REGRESSION') } };
  } catch { return failure(); }
}

/** Independent transaction audit: derives facts directly from resolved packets and
 * registry records, without using the search's ledger, pins or claimed scores. */
export function auditSlotPriorityTransactionV3({ baseline, before, after, phase, dayIndex, donors = [], receiver,
  removedStructural = [] } = {}) {
  try {
    const reasons = [];
    const reject = rule => reasons.push({ code: 'SLOT_PRIORITY_RULE_' + rule });
    const rx = ok(buildVolumePrescriptionV3({ goal: baseline.equipmentContext.goal, tier: baseline.tier }));
    const facts = w => {
      const total = ok(weeklyPrescribedGroupTotals(w));
      const coverage = ok(evaluateWeeklyCoverage(w,{ durationMinutes: w.durationMinutes }));
      const direct = Object.fromEntries(['calves','lateral_delts'].map(kind => [kind,w.days.flatMap(d => d.slots)
        .filter(s => s.slotKind.pattern === 'ACC' && s.slotKind.accessoryKind === kind
          && ok(groupContributionFor(s)).groups[kind === 'calves' ? 'calves' : 'side_delts'] === s.sets).length]));
      const credit = { ...total.totals, ...Object.fromEntries(Object.entries(total.diagnostics.muscleTotals).map(([k,v]) => ['muscle:'+k,v])) };
      const patterns = {}, dayPatterns = [], deadlifts = [];
      for (const day of w.days) {
        const native = {}; let deadlift = 0;
        for (const slot of day.slots) {
          const record = getExerciseById(slot.exerciseId);
          const keys = ['registry:'+record.primaryPattern,...(slot.slotKind.pattern === 'ACC' ? [] : ['slot:'+slot.slotKind.pattern])];
          for (const key of keys) patterns[key] = (patterns[key] || 0) + 1;
          native[record.primaryPattern] = (native[record.primaryPattern] || 0) + 1;
          deadlift += Number([record.primaryFamilyId,...record.componentFamilyIds].some(f => DEADLIFT_FAMILIES.has(f)));
        }
        dayPatterns.push(native); deadlifts.push(deadlift);
      }
      const severity = deadlifts.reduce((n,c) => n+Math.max(0,c-1),0)
        + dayPatterns.reduce((n,p) => n+Object.values(p).reduce((s,c) => s+Math.max(0,c-2),0),0);
      return { total: total.totals, coverage, direct, credit, patterns, severity };
    };
    const base = facts(baseline), a = facts(before), b = facts(after);
    const objective = f => {
      const ds = MAJOR_GROUPS.map(g => Math.max(0,rx.groups[g].target.min-(f.total[g] || 0))/rx.groups[g].target.min);
      return { max: Math.max(...ds), sum: ds.reduce((n,v) => n+v,0) };
    };
    if (Object.entries(base.coverage.requirements).some(([k,r]) => r.required
      && b.coverage.requirements[k].achieved < Math.min(r.target,r.achieved))) reject(1);
    if (!acceptSlotPriorityScoreV3(objective(a),objective(b),phase,1e-12)) reject(2);
    if (['calves','lateral_delts'].some(kind => base.direct[kind] > 0 && b.direct[kind] === 0)
        || ['calves','side_delts'].some(g => b.total[g] < base.total[g])) reject(3);
    if (Object.entries(base.credit).some(([k,v]) => v > 0 && !(b.credit[k] > 0))) reject(5);
    const context = contextOf(baseline), template = ok(buildWeeklyTemplateV3(context));
    if (receiver) {
      const region = slotRegionV3(receiver), day = dayRegionV3(template.days[dayIndex]);
      if (!(day && region && (day === 'full' || region === day || region === 'neutral'))) reject(6);
    }
    if (phase === 'mandatory_rule7') {
      const oldDay = before.days[dayIndex], newDay = after.days[dayIndex];
      const index = donors.length === 1 ? oldDay.slots.findIndex(s => equal(s,donors[0])) : -1;
      if (b.severity >= a.severity || index < 0 || !receiver || oldDay.slots.length !== newDay.slots.length
          || !equal(newDay.slots[index],receiver) || !equal(receiver.slotKind,donors[0].slotKind)
          || receiver.templateSlotIndex !== donors[0].templateSlotIndex
          || oldDay.slots.some((s,i) => i !== index && !equal(s,newDay.slots[i]))) reject(7);
    } else if (b.severity !== 0) reject(7);
    const keysFor = s => ['registry:'+getExerciseById(s.exerciseId).primaryPattern,
      ...(s.slotKind.pattern === 'ACC' ? [] : ['slot:'+s.slotKind.pattern])];
    for (const donor of donors) {
      const sole = keysFor(donor).some(k => a.patterns[k] === 1)
        || (baseline.days.some(d => d.slots.some(s => equal(s,donor))) && keysFor(donor).some(k => base.patterns[k] === 1));
      if (sole && !(donor.slotKind.pattern === 'VPU' && b.total.front_delts >= rx.groups.front_delts.target.min)) reject(8);
      const groups = ok(groupContributionFor(donor)).groups;
      if (MAJOR_GROUPS.some(g => groups[g] === donor.sets && a.total[g] < rx.groups[g].target.min)) reject(10);
    }
    if (Math.max(0,b.total.chest-b.total.back) > Math.max(0,base.total.chest-base.total.back)) reject(9);
    if (phase === 'optional' && receiver && ['SQ','HG','LU','HPU','HPL','VPU','VPL'].includes(receiver.slotKind.pattern)) {
      const growth = before.days[dayIndex].slots.some(s => s.exerciseId === receiver.exerciseId && equal(s.slotKind,receiver.slotKind));
      if (!growth && (before.days[dayIndex].slots.some(s => s.slotKind.pattern === receiver.slotKind.pattern)
          || removedStructural.includes(receiver.slotKind.pattern))) reject(11);
    }
    if (before.days.some((day,i) => i !== dayIndex && !equal(day,after.days[i]))) return failure();
    return { ok: reasons.length === 0, reasons };
  } catch { return failure(); }
}

export function acceptSlotPriorityScoreV3(before, after, phase, tolerance = 0) {
  if (![before?.max,before?.sum,after?.max,after?.sum,tolerance].every(Number.isFinite) || tolerance < 0) return false;
  return phase === 'mandatory_rule7' ? after.max <= before.max + tolerance
    : phase === 'optional' && (after.max < before.max - tolerance
      || (Math.abs(after.max-before.max) <= tolerance && after.sum < before.sum - tolerance));
}

export function compareSlotPriorityChoicesV3(a,b) {
  return (a.repairPower??0)-(b.repairPower??0)||a.score.max-b.score.max||a.score.sum-b.score.sum||a.severity-b.severity
    ||a.donors.length-b.donors.length||a.kindRank-b.kindRank||a.preference-b.preference
    ||(a.receiverId<b.receiverId?-1:a.receiverId>b.receiverId?1:0)||a.di-b.di;
}

/** Optional arms-tier winners take precedence; mandatory repairs compare all
 * admissible replacements, with non-power receivers first for muscle_gain. */
export function chooseSlotPriorityDonorTierV3(arms,other,repair) {
  return repair && arms && other ? (compareSlotPriorityChoicesV3(arms,other)<=0 ? arms : other) : (arms || other);
}

/** Same code alone is insufficient: the complete issue packet, location and
 * protected outcome must match the independently reconstructed pre-port 2k path.
 * A surviving transaction receiver/grown packet is never grandfathered. */
export function validateSlotPriority2kBoundaryV3({ issues, prePortIssues, expectedWeek, actualWeek, transactions }) {
  const reasons = [], reportOnly = [];
  for (const tx of transactions) {
    for (const slot of tx.afterSlots) {
      if (tx.beforeSlots.some(before => equal(before,slot))) continue;
      if (!expectedWeek.days[tx.dayIndex].slots.some(expected => equal(expected,slot))) continue;
      if (!actualWeek.days[tx.dayIndex].slots.some(actual => equal(actual,slot))) {
        reasons.push({ code: 'SLOT_PRIORITY_TRANSACTION_SLOT_CHANGED', dayIndex: tx.dayIndex,
          exerciseId: slot.exerciseId, slotKind: slot.slotKind, sets: slot.sets });
      }
    }
  }
  for (const issue of issues) {
    const eligible = ['SLOT_PRIORITY_RULE6_REGION','SLOT_PRIORITY_PROTECTED_REGRESSION'].includes(issue.code);
    if (eligible && prePortIssues.some(previous => equal(previous,issue)))
      reportOnly.push({ ...structuredClone(issue), classification: 'PRE_EXISTING_2K' });
    else reasons.push(issue);
  }
  return { ok: reasons.length === 0, reasons, reportOnly };
}
