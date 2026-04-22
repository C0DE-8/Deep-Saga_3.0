import { useLocation, useNavigate } from "react-router-dom";
import { UserCircle2, BookOpen, Newspaper, Plus } from "lucide-react";
import styles from "./BottomNav.module.css";

const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isProfile = location.pathname === "/profile";
  const isGame = location.pathname === "/dashboard" || location.pathname === "/game";

  return (
    <footer className={styles.footer}>
      <button
        className={`${styles.navItem} ${isProfile ? styles.active : ""}`}
        type="button"
        onClick={() => navigate("/profile")}
        aria-label="Open profile"
      >
        <div className={styles.profileWrap}>
          <UserCircle2 size={27} />
          <span className={styles.greenPlus}>
            <Plus size={16} />
          </span>
        </div>
      </button>

      <button
        className={`${styles.navItem} ${isGame ? styles.active : ""}`}
        type="button"
        onClick={() => navigate("/dashboard")}
        aria-label="Open dashboard"
      >
        <BookOpen size={29} />
      </button>

      <button className={styles.navItem} type="button" aria-label="Open journal">
        <Newspaper size={27} />
      </button>
    </footer>
  );
};

export default BottomNav;
