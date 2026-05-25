import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { foodDatabase, macrosForGrams, searchFoodDatabase } from '../../../data/foodDatabase';
import { GlassCard } from './GlassCard';

const CATEGORIES = ['all', 'protein', 'carbs', 'vegetables', 'fruits', 'dairy', 'snacks', 'fats'];

export function FoodDatabaseSearch({ onAddEntry }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [grams, setGrams] = useState('100');
  const [status, setStatus] = useState('');

  const results = useMemo(() => {
    const matched = searchFoodDatabase(query);
    if (category === 'all') return matched;
    return matched.filter(food => food.category === category);
  }, [query, category]);

  const selectedFood = foodDatabase.find(food => food.id === selectedId) || null;
  const preview = selectedFood ? macrosForGrams(selectedFood, grams) : null;

  const handleAdd = () => {
    if (!selectedFood || !preview) return;
    onAddEntry?.({
      name: `${selectedFood.name} (${preview.grams}g)`,
      kcal: preview.calories,
      protein: preview.protein,
      carbs: preview.carbs,
      fat: preview.fat,
    });
    setStatus(`Added ${selectedFood.name} to today's log.`);
    setSelectedId(null);
    setGrams('100');
  };

  return (
    <GlassCard id="food-database">
      <div className="flex items-center gap-2 mb-3">
        <Search size={20} color="#CCFF00" />
        <h3 style={{ margin: 0 }}>Nutrition Bank</h3>
      </div>
      <p className="text-xs text-white/45 mb-3">
        Search {foodDatabase.length}+ foods. Enter grams to calculate macros for your portion.
      </p>

      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search chicken, rice, apple..."
        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-[#CCFF00]/50"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide ${
              category === cat
                ? 'bg-[#CCFF00] text-black'
                : 'border border-white/10 bg-white/[0.06] text-white/55'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
        {results.slice(0, 12).map(food => (
          <button
            key={food.id}
            type="button"
            onClick={() => {
              setSelectedId(food.id);
              setStatus('');
            }}
            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
              selectedId === food.id
                ? 'border-[#CCFF00]/50 bg-[#CCFF00]/10'
                : 'border-white/10 bg-white/[0.04] hover:border-white/20'
            }`}
          >
            <span className="text-xl">{food.emoji}</span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-white">{food.name}</span>
              <span className="text-[11px] text-white/45">
                {food.per100g.calories} kcal · P{food.per100g.protein} C{food.per100g.carbs} F{food.per100g.fat} per 100g
              </span>
            </span>
          </button>
        ))}
        {!results.length && <p className="text-xs text-white/45">No foods match your search.</p>}
      </div>

      {selectedFood && (
        <div className="mt-4 rounded-2xl border border-[#CCFF00]/25 bg-[#0A0A0A] p-4">
          <p className="text-sm font-black text-white">
            {selectedFood.emoji} {selectedFood.name}
          </p>
          <label className="mt-3 block text-xs font-bold text-white/55">
            Portion (grams)
            <input
              type="number"
              min="1"
              value={grams}
              onChange={e => setGrams(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#CCFF00]/50"
            />
          </label>
          {preview && (
            <p className="mt-3 text-xs text-white/65">
              {preview.calories} kcal · P{preview.protein}g · C{preview.carbs}g · F{preview.fat}g
            </p>
          )}
          <button
            type="button"
            onClick={handleAdd}
            className="mt-3 w-full rounded-xl bg-[#CCFF00] py-3 text-xs font-black text-black"
          >
            Add to Today&apos;s Log
          </button>
        </div>
      )}

      {status && <p className="mt-3 text-xs font-bold text-[#CCFF00]">{status}</p>}
    </GlassCard>
  );
}
