import api from "./axios";

export const getCurrentWorld = async () => {
  const response = await api.get("/world/current");
  return response.data;
};

export const startWorld = async () => {
  const response = await api.post("/world/start");
  return response.data;
};

export const resolveWorldAction = async (action) => {
  const response = await api.post("/world/action", { action });
  return response.data;
};
