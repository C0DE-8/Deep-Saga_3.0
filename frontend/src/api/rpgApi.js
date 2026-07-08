import api from "./axios";

export const getRpgState = async () => {
  const response = await api.get("/rpg/state");
  return response.data;
};

export const startRpg = async ({ name, restart = false }) => {
  const response = await api.post("/rpg/start", { name, restart });
  return response.data;
};

export const resolveRpgAction = async ({ actionKey }) => {
  const response = await api.post("/rpg/action", { action_key: actionKey });
  return response.data;
};
