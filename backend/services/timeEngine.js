function getActionTimeCost(actionKey) {
  const costs = {
    move: 1,
    look: 1,
    rest: 2,
    hide: 1,
    appraise: 0,
    attack: 1,
    defend: 1,
    typed: 1
  };

  return costs[actionKey] || 1;
}

function applyTime({ year, day, hour, hoursToAdd }) {
  let nextYear = Number(year) || 1;
  let nextDay = Number(day) || 1;
  let nextHour = Number(hour) || 0;

  nextHour += Number(hoursToAdd) || 0;

  if (nextHour >= 24) {
    nextDay += Math.floor(nextHour / 24);
    nextHour = nextHour % 24;
  }

  if (nextDay > 365) {
    nextYear += Math.floor((nextDay - 1) / 365);
    nextDay = ((nextDay - 1) % 365) + 1;
  }

  return {
    year: nextYear,
    day: nextDay,
    hour: nextHour
  };
}

function getTimeOfDay(hour) {
  const h = Number(hour);

  if (h >= 5 && h <= 11) return "morning";
  if (h >= 12 && h <= 16) return "afternoon";
  if (h >= 17 && h <= 20) return "evening";
  return "night";
}

module.exports = {
  getActionTimeCost,
  applyTime,
  getTimeOfDay
};