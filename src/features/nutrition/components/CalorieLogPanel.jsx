import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { mockSearchFoodsLocal, searchFoods } from '../api/nutritionApi';
import { useNutritionStore } from '../store/nutritionStore';
import { GlassCard } from './GlassCard';

export function CalorieLogPanel({ remoteSearch = false }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const foodLog = useNutritionStore(s => s.foodLog);
  const addFoodEntry = useNutritionStore(s => s.addFoodEntry);
  const removeFoodEntry = useNutritionStore(s => s.removeFoodEntry);

  const today = useMemo(() => new Date().toDateString(), []);

  const todayLog = useMemo(
    () => foodLog.filter(e => new Date(e.at).toDateString() === today),
    [foodLog, today],
  );

  const totals = useMemo(() => {
    return todayLog.reduce(
      (a, e) => ({
        kcal: a.kcal + e.kcal,
        protein: a.protein + e.protein,
        carbs: a.carbs + e.carbs,
        fat: a.fat + e.fat,
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }, [todayLog]);

  const runSearch = useCallback(
    async query => {
      if (!remoteSearch) {
        setHits(mockSearchFoodsLocal(query));
        return;
      }
      try {
        const data = await searchFoods(query);
        setHits(data);
      } catch {
        setHits(mockSearchFoodsLocal(query));
      }
    },
    [remoteSearch],
  );

  useEffect(() => {
    const t = setTimeout(() => runSearch(q), 200);
    return () => clearTimeout(t);
  }, [q, runSearch]);

  return (
    <GlassCard>
      <div className="np-row-between" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Log calories today</h3>
        <span className="np-badge">{Math.round(totals.kcal)} kcal</span>
      </div>

      <div className="np-search-wrap">
        <Search className="np-search-icon" size={16} />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search food…"
          className="np-input"
        />
      </div>

      {hits.length > 0 && (
        <ul className="np-list" style={{ marginBottom: 12 }}>
          {hits.map(item => (
            <li key={item.id} className="np-list-item">
              <div>
                <p>{item.name}</p>
                <small>
                  {item.kcal} kcal · P{item.protein} C{item.carbs} F{item.fat}
                </small>
              </div>
              <button
                type="button"
                className="np-btn-icon"
                onClick={() =>
                  addFoodEntry({
                    name: item.name,
                    kcal: item.kcal,
                    protein: item.protein,
                    carbs: item.carbs,
                    fat: item.fat,
                  })
                }
                aria-label="Add"
              >
                <Plus size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="np-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        Logged today
      </p>
      {todayLog.length === 0 ? (
        <p className="np-muted">Nothing logged yet.</p>
      ) : (
        <ul className="np-list">
          {todayLog.map(e => (
            <li key={e.id} className="np-list-item">
              <div>
                <p>{e.name}</p>
                <small>
                  {e.kcal} kcal · P{e.protein} · C{e.carbs} · F{e.fat}
                </small>
              </div>
              <button type="button" className="np-btn-icon" style={{ background: 'transparent', color: '#71717a' }} onClick={() => removeFoodEntry(e.id)} aria-label="Remove">
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
