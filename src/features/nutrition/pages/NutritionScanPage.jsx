import { useNutritionStore } from '../store/nutritionStore';
import { FoodScanner } from '../components/FoodScanner';

export default function NutritionScanPage() {
  const addFoodEntry = useNutritionStore(s => s.addFoodEntry);

  return (
    <main className="np-main">
      <FoodScanner
        onAnalyzed={r =>
          addFoodEntry({
            name: r.label,
            kcal: r.kcal,
            protein: r.protein,
            carbs: r.carbs,
            fat: r.fat,
          })
        }
      />
    </main>
  );
}
