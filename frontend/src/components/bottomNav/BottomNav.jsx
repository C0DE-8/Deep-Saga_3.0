import { useNavigate } from "react-router-dom";
import { BookOpen } from "lucide-react";
import styles from "./BottomNav.module.css";

const BottomNav = () => {
  const navigate = useNavigate();

  return (
    <footer className={styles.footer}>
      <button
        className={`${styles.navItem} ${styles.active}`}
        type="button"
        onClick={() => navigate("/dashboard")}
        aria-label="Open game"
      >
        <BookOpen size={29} />
      </button>
    </footer>
  );
};

export default BottomNav;
