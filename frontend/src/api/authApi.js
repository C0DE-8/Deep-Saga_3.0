import api from "./axios";

export const registerUser = async (payload) => {
  const response = await api.post("/auth/register", {
    username: String(payload?.username || "").trim(),
    email: String(payload?.email || "").trim(),
    password: payload?.password || "",
    name: String(payload?.name || payload?.username || "").trim()
  });

  return response.data;
};

export const loginUser = async (payload) => {
  const identifier = String(payload?.identifier || payload?.email || payload?.username || "").trim();

  const response = await api.post("/auth/login", {
    identifier,
    password: payload?.password || ""
  });

  return response.data;
};

export const persistAuthSession = (data) => {
  if (!data?.token) return null;

  localStorage.setItem("token", data.token);

  const role = data?.user?.role || "player";
  localStorage.setItem("role", role);

  return {
    token: data.token,
    user: data.user || null,
    role
  };
};

export const getAuthErrorMessage = (error, fallback = "Authentication failed") => {
  return error?.response?.data?.message || error?.response?.data?.error || fallback;
};
