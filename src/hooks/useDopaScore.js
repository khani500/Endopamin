export const useDopaScore = ({ checkIn, caloriesLogged = 0, todayWorkout } = {}) => {
  const sleepLogged = checkIn?.sleep ? 25 : 0;
  const nutritionOnTrack = caloriesLogged > 0 ? 25 : 0;
  const workoutDone = todayWorkout?.completed ? 30 : 0;
  const checkInDone = checkIn?.submitted ? 20 : 0;

  const total = sleepLogged + nutritionOnTrack + workoutDone + checkInDone;
  const color = total >= 71 ? '#CCFF00' : total >= 41 ? '#FFD700' : '#FF4444';

  return {
    score: total,
    color,
    breakdown: {
      sleep: sleepLogged,
      nutrition: nutritionOnTrack,
      workout: workoutDone,
      checkIn: checkInDone,
    },
  };
};

