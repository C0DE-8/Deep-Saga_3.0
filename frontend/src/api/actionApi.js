import api from "./axios";

export const resolveAction = async (action) => {
  const response = await api.post("/action", { action });
  return response.data;
};
