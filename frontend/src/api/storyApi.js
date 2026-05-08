import api from "./axios";

export const getChronicle = async ({ limit = 30, offset = 0 } = {}) => {
  const { data } = await api.get("/story/chronicle", {
    params: { limit, offset }
  });
  return data;
};

export const getStoryChapters = async () => {
  const { data } = await api.get("/story/chapters");
  return data;
};

export const getStoryEvent = async (id) => {
  const { data } = await api.get(`/story/events/${id}`);
  return data;
};
