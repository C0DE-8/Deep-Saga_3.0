import api from "./axios";

export const startGame = async () => {
  const response = await api.post("/play/start");
  return response.data;
};

export const getCurrentGame = async () => {
  const response = await api.get("/play/current");
  return response.data;
};
