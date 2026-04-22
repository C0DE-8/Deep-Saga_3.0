import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import Dashboard from "./pages/dashboard/Dashboard";
import Profile from "./pages/profile/Profile";
import NotFound from "./pages/not-found/NotFound";
import ProtectedRoute from "./components/ProtectedRoute";
import styles from "./App.module.css";

function App() {
  return (
    <div className={styles.app}>
      <BrowserRouter>
        {/* The Toaster handles the glass notifications */}
        <Toaster
          position="top-right"
          reverseOrder={false}
          toastOptions={{
            className: styles.glassToast,
            duration: 4000,
            style: {
              background: 'transparent',
              color: '#d2e9ff',
              boxShadow: 'none',
              padding: '0',
            },
            success: {
              iconTheme: {
                primary: '#81ffac',
                secondary: '#030613',
              },
            },
            error: {
              iconTheme: {
                primary: '#ff5e5e',
                secondary: '#030613',
              },
            },
          }}
        />

        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/game"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
