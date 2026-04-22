import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Minus, Plus, RefreshCw, Save, UserCircle2 } from "lucide-react";
import BottomNav from "../../components/bottomNav/BottomNav";
import Header from "../../components/Header/header";
import {
  allocatePlayerStats,
  getPlayerProfile,
  getPlayerSkills,
  updatePlayerPersona
} from "../../api/playerApi";
import styles from "./Profile.module.css";

const STAT_KEYS = [
  ["strength", "Strength", "strength_stat"],
  ["dexterity", "Dexterity", "dexterity_stat"],
  ["stamina", "Stamina", "stamina_stat"],
  ["intelligence", "Intelligence", "intelligence_stat"],
  ["charisma", "Charisma", "charisma_stat"],
  ["wisdom", "Wisdom", "wisdom_stat"]
];

const PERSONAS = ["ADMIN", "TRICKSTER", "SENSEI"];

const getErrorMessage = (error, fallback = "Request failed") => {
  return error?.response?.data?.message || error?.response?.data?.error || fallback;
};

const Profile = () => {
  const [player, setPlayer] = useState(null);
  const [skills, setSkills] = useState([]);
  const [conditionStats, setConditionStats] = useState([]);
  const [persona, setPersona] = useState("ADMIN");
  const [allocation, setAllocation] = useState(() => (
    STAT_KEYS.reduce((acc, [key]) => ({ ...acc, [key]: 0 }), {})
  ));
  const [loading, setLoading] = useState(true);
  const [savingPersona, setSavingPersona] = useState(false);
  const [allocating, setAllocating] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);

    try {
      const [profileData, skillsData] = await Promise.all([
        getPlayerProfile(),
        getPlayerSkills()
      ]);

      setPlayer(profileData.player);
      setPersona(profileData.player?.persona || "ADMIN");
      setSkills(skillsData.skills || []);
      setConditionStats(skillsData.condition_stats || []);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load profile"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const allocatedTotal = useMemo(() => (
    Object.values(allocation).reduce((sum, value) => sum + value, 0)
  ), [allocation]);
  const availablePoints = Math.max(0, Number(player?.stat_points || 0) - allocatedTotal);

  const changeAllocation = (key, delta) => {
    setAllocation((current) => {
      const nextValue = Math.max(0, Number(current[key] || 0) + delta);
      const next = { ...current, [key]: nextValue };
      const nextTotal = Object.values(next).reduce((sum, value) => sum + value, 0);

      if (nextTotal > Number(player?.stat_points || 0)) return current;
      return next;
    });
  };

  const resetAllocation = () => {
    setAllocation(STAT_KEYS.reduce((acc, [key]) => ({ ...acc, [key]: 0 }), {}));
  };

  const saveAllocation = async () => {
    if (!allocatedTotal || allocating) return;

    setAllocating(true);
    try {
      const data = await allocatePlayerStats(allocation);
      setPlayer((current) => ({ ...current, ...data.player }));
      resetAllocation();
      toast.success(data.message || "Stats allocated");
      await loadProfile();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to allocate stats"));
    } finally {
      setAllocating(false);
    }
  };

  const savePersona = async () => {
    if (!persona || savingPersona) return;

    setSavingPersona(true);
    try {
      const data = await updatePlayerPersona(persona);
      setPlayer((current) => ({ ...current, persona: data.persona || persona }));
      toast.success(data.message || "Persona updated");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to update persona"));
    } finally {
      setSavingPersona(false);
    }
  };

  return (
    <div className={styles.page}>
      <Header floor={player?.current_floor ?? 1} title="Profile" />

      <main className={styles.content}>
        {loading ? (
          <section className={styles.loading}>
            <RefreshCw size={28} />
            <p>Loading profile...</p>
          </section>
        ) : (
          <>
            <section className={styles.hero}>
              <UserCircle2 size={56} />
              <div>
                <h2>{player?.name || "Nameless"}</h2>
                <p>{player?.current_race || "Lost Soul"} · {player?.current_title || "Unawakened"}</p>
              </div>
            </section>

            <section className={styles.summaryGrid}>
              <span>Level <strong>{player?.level ?? 0}</strong></span>
              <span>EXP <strong>{player?.exp ?? 0}</strong></span>
              <span>HP <strong>{player?.hp ?? 0}/{player?.max_hp ?? 0}</strong></span>
              <span>Life <strong>{player?.life_number ?? 1}</strong></span>
              <span>Floor <strong>{player?.current_floor ?? 1}</strong></span>
              <span>Time <strong>{player?.time_of_day || "night"}</strong></span>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3>Persona</h3>
                <button className={styles.iconButton} type="button" onClick={savePersona} disabled={savingPersona}>
                  <Save size={18} />
                </button>
              </div>
              <select className={styles.select} value={persona} onChange={(event) => setPersona(event.target.value)}>
                {PERSONAS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3>Stats</h3>
                <span>{availablePoints} points</span>
              </div>

              <div className={styles.statsList}>
                {STAT_KEYS.map(([key, label, apiKey]) => (
                  <div className={styles.statRow} key={key}>
                    <div>
                      <span>{label}</span>
                      <strong>{Number(player?.[apiKey] || 0) + Number(allocation[key] || 0)}</strong>
                    </div>
                    <div className={styles.stepper}>
                      <button type="button" onClick={() => changeAllocation(key, -1)} disabled={!allocation[key] || allocating}>
                        <Minus size={16} />
                      </button>
                      <span>{allocation[key]}</span>
                      <button type="button" onClick={() => changeAllocation(key, 1)} disabled={!availablePoints || allocating}>
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.actions}>
                <button className={styles.secondaryButton} type="button" onClick={resetAllocation} disabled={!allocatedTotal || allocating}>
                  Reset
                </button>
                <button className={styles.primaryButton} type="button" onClick={saveAllocation} disabled={!allocatedTotal || allocating}>
                  {allocating ? "Allocating..." : "Allocate"}
                </button>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3>Skills</h3>
                <span>{skills.length}</span>
              </div>
              {skills.length ? (
                <div className={styles.skillList}>
                  {skills.map((skill) => (
                    <div className={styles.skillItem} key={skill.skill_key || skill.id || skill.name}>
                      <strong>{skill.name || skill.skill_key}</strong>
                      <span>{skill.skill_type || skill.category || "skill"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyText}>No skills unlocked yet.</p>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3>Condition</h3>
                <span>{conditionStats.length}</span>
              </div>
              {conditionStats.length ? (
                <div className={styles.conditionGrid}>
                  {conditionStats.map((stat) => (
                    <span key={stat.stat_key}>
                      {stat.stat_key}
                      <strong>{stat.stat_value}</strong>
                    </span>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyText}>No condition progress recorded.</p>
              )}
            </section>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
};

export default Profile;
