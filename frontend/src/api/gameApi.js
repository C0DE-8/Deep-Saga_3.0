import api from "./axios";

export const startGame = async () => {
  const response = await api.post("/game/start");
  return response.data;
};

export const getCurrentGame = async () => {
  const response = await api.get("/game/current");
  return response.data;
};
