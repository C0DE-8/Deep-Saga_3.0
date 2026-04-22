import { Navigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";

const AdminRoute = ({ children }) => {
  const token = localStorage.getItem("token");
  let decoded;

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  try {
    decoded = jwtDecode(token);
  } catch {
    localStorage.clear();
    return <Navigate to="/login" replace />;
  }

  if (decoded.role === "admin") {
    return children;
  }

  return <Navigate to="/dashboard" replace />;
};

export default AdminRoute;
