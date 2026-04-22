import api from "./axios";

export const getAscensionStatus = async () => {
  const response = await api.get("/ascension/status");
  return response.data;
};

export const submitFinalWish = async (wish) => {
  const response = await api.post("/ascension/wish", { wish });
  return response.data;
};
