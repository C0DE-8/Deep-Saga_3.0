import React from "react";
import { Menu, MoreVertical } from "lucide-react";
import styles from "./Header.module.css";

const Header = ({ floor = 1, title = "Deep Saga" }) => {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <button className={styles.iconBtn} type="button" aria-label="Open menu">
            <Menu size={26} />
          </button>
          <span className={styles.floor}>{floor}</span>
        </div>

        <h1 className={styles.title}>{title}</h1>

        <button className={styles.iconBtn} type="button" aria-label="More options">
          <MoreVertical size={26} />
        </button>
      </div>
    </header>
  );
};

export default Header;
