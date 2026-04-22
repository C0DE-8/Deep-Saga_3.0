import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { jwtDecode } from "jwt-decode"; // Import the decoder
import {
  getAuthErrorMessage,
  loginUser,
  persistAuthSession
} from "../../api/authApi";
import PortalLines from "../../components/auth/PortalLines";
import styles from "./Auth.module.css";

const glitchText = (text) => {
  return text.split("").map((char, index) => {
    const shouldBlink = char !== " " && [2, 5, 9, 14, 18, 22, 27, 31, 36].includes(index);
    return (
      <span key={`${char}-${index}`} className={shouldBlink ? styles.blinkRune : ""}>
        {char}
      </span>
    );
  });
};

const Login = () => {
  const navigate = useNavigate();
  
  // identifier matches your backend 'email OR username' logic
  const [formData, setFormData] = useState({ identifier: "", password: "" });
  const [loading, setLoading] = useState(false);

  const portalParticles = useMemo(() => {
    return Array.from({ length: 18 }, (_, i) => ({
      id: i, size: Math.floor(Math.random() * 8) + 4,
      left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
      delay: `${Math.random() * 6}s`, duration: `${5 + Math.random() * 8}s`
    }));
  }, []);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await loginUser(formData);
      
      if (data?.token) {
        const session = persistAuthSession(data);
        
        const decoded = jwtDecode(data.token);
        const userRole = decoded.role || session?.role || "player";
        localStorage.setItem("role", userRole);
        
        toast.success(data?.message || "Soul synchronized");

        if (userRole === "admin") {
          navigate("/admin");
        } else {
          navigate("/dashboard");
        }
      }
    } catch (error) {
      toast.error(getAuthErrorMessage(error, "Synchronization failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.authPage}>
      <PortalLines />
      <div className={styles.smokeLayer}></div>
      <div className={styles.smokeLayerTwo}></div>
      <div className={styles.portalGlow}></div>
      <div className={styles.vignette}></div>

      {portalParticles.map((particle) => (
        <span key={particle.id} className={styles.particle}
          style={{
            width: `${particle.size}px`, height: `${particle.size}px`,
            left: particle.left, top: particle.top,
            animationDelay: particle.delay, animationDuration: particle.duration
          }}
        />
      ))}

      <div className={styles.authShell}>
        <form className={styles.authCard} onSubmit={handleSubmit}>
          <div className={styles.cornerTL}></div>
          <div className={styles.cornerTR}></div>
          <div className={styles.cornerBL}></div>
          <div className={styles.cornerBR}></div>

          <p className={styles.systemState}>SYSTEM ACCEPTING ACCESS</p>
          <h1 className={styles.title}>{glitchText("SOUL SYNCHRONIZATION")}</h1>
          <p className={styles.subtitle}>STATUS: OFFLINE. AWAITING SOUL VERIFICATION.</p>

          <div className={styles.inputGroup}>
            <label className={styles.label}>SOUL IDENTIFIER</label>
            <input
              type="text"
              name="identifier"
              placeholder="Email or Username"
              value={formData.identifier}
              onChange={handleChange}
              className={styles.input}
              required
            />
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>SECRET KEY</label>
            <input
              type="password"
              name="password"
              placeholder="Enter your secret key"
              value={formData.password}
              onChange={handleChange}
              className={styles.input}
              required
            />
          </div>

          <button type="submit" className={styles.portalButton} disabled={loading}>
            {loading ? "SYNCHRONIZING..." : "SYNCHRONIZE SOUL"}
          </button>

          <Link to="/register" className={styles.secondaryButton}>REGISTER NEW SOUL</Link>
          <p className={styles.footerText}>SYSTEM VERSION 0.9.1 | VOICE OF THE WORLD</p>
        </form>
      </div>
    </div>
  );
};

export default Login;
