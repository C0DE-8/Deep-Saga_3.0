import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
  getAuthErrorMessage,
  persistAuthSession,
  registerUser
} from "../../api/authApi";
import PortalLines from "../../components/auth/PortalLines";
import styles from "./Auth.module.css";

const glitchText = (text) => {
  return text.split("").map((char, index) => {
    const shouldBlink = char !== " " && [2, 5, 9, 14, 18, 22].includes(index);
    return (
      <span key={`${char}-${index}`} className={shouldBlink ? styles.blinkRune : ""}>
        {char}
      </span>
    );
  });
};

const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ username: "", email: "", password: "" });
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
      const data = await registerUser(formData);
      persistAuthSession(data);
      toast.success(data?.message || "Soul record created");
      navigate("/dashboard");
    } catch (error) {
      toast.error(getAuthErrorMessage(error, "Registration failed"));
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

          <p className={styles.systemState}>INITIALIZING NEW SOUL</p>
          <h1 className={styles.title}>{glitchText("SOUL MANIFESTATION")}</h1>
          <p className={styles.subtitle}>STATUS: FORMING. PROVIDE IDENTITY DATA.</p>

          <div className={styles.inputGroup}>
            <label className={styles.label}>SOUL NAME</label>
            <input
              type="text"
              name="username"
              placeholder="Enter soul name"
              value={formData.username}
              onChange={handleChange}
              className={styles.input}
              required
            />
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>SOUL EMAIL</label>
            <input
              type="email"
              name="email"
              placeholder="Enter soul email"
              value={formData.email}
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
              placeholder="Create secret key"
              value={formData.password}
              onChange={handleChange}
              className={styles.input}
              required
            />
          </div>

          <button type="submit" className={styles.portalButton} disabled={loading}>
            {loading ? "MANIFESTING..." : "MANIFEST SOUL"}
          </button>

          <Link to="/login" className={styles.secondaryButton}>RECALL EXISTING SOUL</Link>
          <p className={styles.footerText}>SYSTEM VERSION 0.9.1 | VOICE OF THE WORLD</p>
        </form>
      </div>
    </div>
  );
};

export default Register;
