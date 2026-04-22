import api from "./axios";

export const getPlayerProfile = async () => {
  const response = await api.get("/player/profile");
  return response.data;
};

export const getPlayerSkills = async () => {
  const response = await api.get("/player/skills");
  return response.data;
};

export const allocatePlayerStats = async (stats) => {
  const response = await api.post("/player/allocate-stats", stats);
  return response.data;
};

export const updatePlayerPersona = async (persona) => {
  const response = await api.post("/player/persona", { persona });
  return response.data;
};
