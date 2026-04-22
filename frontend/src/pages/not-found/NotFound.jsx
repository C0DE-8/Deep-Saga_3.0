import { Link } from "react-router-dom";
import styles from "./NotFound.module.css";

const NotFound = () => {
  const hasToken = Boolean(localStorage.getItem("token"));

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="not-found-title">
        <p className={styles.code}>ERROR 404</p>
        <h1 id="not-found-title" className={styles.title}>
          Route Not Found
        </h1>
        <p className={styles.message}>
          The requested path is outside the current Deep Saga route map.
        </p>

        <div className={styles.actions}>
          <Link className={styles.primaryLink} to={hasToken ? "/dashboard" : "/login"}>
            {hasToken ? "Return to Dashboard" : "Return to Login"}
          </Link>
          {!hasToken && (
            <Link className={styles.secondaryLink} to="/register">
              Register New Soul
            </Link>
          )}
        </div>
      </section>
    </main>
  );
};

export default NotFound;
