// Per-serving library for Dustin's usual foods.
// Branded numbers follow the published label. USDA items are cooked weights.
// Composed bowls are the sum of those servings and stay editable.

function item(id, name, serving, kcal, protein, carbs, fat) {
  return {
    id: id,
    name: name,
    serving: serving,
    kcal: kcal,
    protein: protein,
    carbs: carbs,
    fat: fat
  };
}

export const FOOD_LIBRARY = [
  item('chicken-breast-4', 'Chicken breast, cooked', '4 oz', 187, 35, 0, 4),
  item('chicken-breast-6', 'Chicken breast, cooked', '6 oz', 281, 53, 0, 6),
  item('beef-90-4', 'Ground beef 90/10, cooked', '4 oz', 246, 30, 0, 13),
  item('beef-90-6', 'Ground beef 90/10, cooked', '6 oz', 369, 44, 0, 20),
  item('jasmine-rice-1c', 'Jasmine rice, cooked', '1 cup', 205, 4, 45, 0),
  item('chicken-rice-gravy', 'Chicken, rice, brown gravy, Worcestershire', '1 bowl', 516, 58, 50, 7),
  item('publix-chicken-4', 'Publix rotisserie chicken', '4 oz', 203, 25, 0, 11),
  item('publix-chicken-half', 'Publix rotisserie chicken', '1/2 chicken', 620, 77, 2, 35),
  item('publix-pot-roast', 'Publix pre-cooked pot roast', '5 oz', 170, 25, 4, 6),
  item('egg-large', 'Egg', '1 large', 72, 6, 0, 5),
  item('spaghetti-tomato', 'Spaghetti with tomato juice', '1 cup', 220, 8, 43, 2),
  item('tortellini-cheese', 'Cheese tortellini', '1 cup', 330, 14, 50, 8),
  item('chicken-pasta-bowl', 'Chicken pasta, Frank\'s, mozzarella, Worcestershire', '1 bowl', 497, 49, 45, 11),
  item('beef-taco', 'Crunchy beef taco, meat and cheese', '1 taco', 297, 23, 8, 19),
  item('sirloin-6', 'Steak, sirloin', '6 oz', 311, 51, 0, 11),
  item('ramen-oriental', 'Top Ramen, oriental', '1 pack', 380, 8, 52, 14),
  item('ramen-chicken', 'Top Ramen, chicken', '1 pack', 380, 8, 53, 14),
  item('cheetos-flamin-1', 'Flamin\' Hot Cheetos', '1 oz', 160, 2, 16, 10),
  item('cheetos-flamin-2', 'Flamin\' Hot Cheetos', '2 oz', 320, 4, 32, 20),
  item('cheetos-xxtra-1', 'Xxtra Flamin\' Hot Cheetos', '1 oz', 160, 1, 15, 11),
  item('cheetos-xxtra-2', 'Xxtra Flamin\' Hot Cheetos', '2 oz', 320, 2, 30, 22),
  item('wings-mild-8', 'Pizza Hut boneless wings, buffalo mild', '8 pc', 570, 35, 33, 32),
  item('wings-mild-16', 'Pizza Hut boneless wings, buffalo mild', '16 pc', 1140, 70, 66, 64),
  item('wings-hot-8', 'Pizza Hut boneless wings, buffalo hot', '8 pc', 560, 35, 33, 31),
  item('wings-hot-16', 'Pizza Hut boneless wings, buffalo hot', '16 pc', 1120, 70, 66, 62),
  item('dew-12', 'Mountain Dew', '12 oz can', 170, 0, 46, 0),
  item('dew-20', 'Mountain Dew', '20 oz bottle', 290, 0, 77, 0),
  item('franks-tsp', 'Frank\'s RedHot', '1 tsp', 0, 0, 0, 0),
  item('worcestershire-tsp', 'Worcestershire', '1 tsp', 5, 0, 1, 0)
];

export const USUAL_MEALS = [
  { id: 'usual-chicken-rice', name: 'Chicken + rice', foodIds: ['chicken-breast-6', 'jasmine-rice-1c'] },
  { id: 'usual-beef-rice', name: 'Beef + rice', foodIds: ['beef-90-6', 'jasmine-rice-1c'] }
];

export const SERVING_MULTIPLIERS = [0.5, 1, 1.5, 2];

export function foodById(id) {
  return FOOD_LIBRARY.find(function (food) { return food.id === id; }) || null;
}

export function roundMacro(n) {
  return Math.round(Number(n) * 10) / 10;
}

export function scaleFood(food, multiplier) {
  const m = Number(multiplier);
  return {
    kcal: roundMacro((food.kcal || 0) * m),
    protein: roundMacro((food.protein || 0) * m),
    carbs: roundMacro((food.carbs || 0) * m),
    fat: roundMacro((food.fat || 0) * m)
  };
}

export function makeFoodEntry(food, multiplier, at) {
  const m = Number(multiplier);
  const scaled = scaleFood(food, m);
  return {
    id: food.id + '-' + Math.random().toString(36).slice(2, 8),
    foodId: food.id || 'custom',
    name: String(food.name || 'Food').slice(0, 80),
    serving: String(food.serving || '').slice(0, 40),
    multiplier: m,
    kcal: scaled.kcal,
    protein: scaled.protein,
    carbs: scaled.carbs,
    fat: scaled.fat,
    at: at || new Date().toISOString()
  };
}

export function usualMealEntries(mealId, multiplier) {
  const meal = USUAL_MEALS.find(function (row) { return row.id === mealId; });
  if (!meal) return [];
  return meal.foodIds.map(function (id) {
    const food = foodById(id);
    return food ? makeFoodEntry(food, multiplier == null ? 1 : multiplier) : null;
  }).filter(Boolean);
}

export function emptyFoodLog(date) {
  return { date: date, entries: [], updatedAt: '' };
}

export function foodLogTotals(entries) {
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  (entries || []).forEach(function (entry) {
    totals.kcal += Number(entry.kcal) || 0;
    totals.protein += Number(entry.protein) || 0;
    totals.carbs += Number(entry.carbs) || 0;
    totals.fat += Number(entry.fat) || 0;
  });
  totals.kcal = roundMacro(totals.kcal);
  totals.protein = roundMacro(totals.protein);
  totals.carbs = roundMacro(totals.carbs);
  totals.fat = roundMacro(totals.fat);
  return totals;
}

export function foodEntryIssue(entry) {
  if (!entry || !String(entry.name || '').trim()) return 'Name the food.';
  const m = Number(entry.multiplier);
  if (!Number.isFinite(m) || m <= 0 || m > 20) return 'Servings should be between 0 and 20.';
  const bad = ['kcal', 'protein', 'carbs', 'fat'].some(function (key) {
    const n = Number(entry[key]);
    return !Number.isFinite(n) || n < 0 || n > 5000;
  });
  if (bad) return 'That amount looks off.';
  return '';
}
