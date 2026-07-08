import api from "./axios";

export const getRpgState = async () => {
  const response = await api.get("/rpg/state");
  return response.data;
};

export const startRpg = async ({ restart = false } = {}) => {
  const response = await api.post("/rpg/start", { restart });
  return response.data;
};

export const resolveRpgAction = async ({ actionText }) => {
  const response = await api.post("/rpg/action", { action_text: actionText });
  return response.data;
};
