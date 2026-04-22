import api from "./axios";

export const getRebirthStatus = async () => {
  const response = await api.get("/rebirth/status");
  return response.data;
};

export const restartRebirth = async () => {
  const response = await api.post("/rebirth/restart");
  return response.data;
};

export const submitRebirthWish = async (wish) => {
  const response = await api.post("/rebirth/wish", { wish });
  return response.data;
};
