import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Activity, BookOpen, Heart, Send, Shield, Swords, Zap } from "lucide-react";
import BottomNav from "../../components/bottomNav/BottomNav";
import Header from "../../components/Header/header";
import { getRpgState, resolveRpgAction, startRpg } from "../../api/rpgApi";
import styles from "./Dashboard.module.css";

const CORE_STATS = [
  ["strength", "STR"],
  ["agility", "AGI"],
  ["thaumaturgy", "THAUM"],
  ["vitality", "VIT"],
  ["intelligence", "INT"],
  ["wisdom", "WIS"],
  ["resolve", "RES"],
  ["dexterity", "DEX"],
  ["perception", "PER"],
  ["luck", "LUK"],
  ["charisma", "CHA"],
  ["health", "Health"]
];

const DERIVED_STATS = [
  ["defense", "DEF"],
  ["magic_attack", "M.ATK"],
  ["magic_defense", "M.DEF"],
  ["critical_rate", "CRIT"],
  ["dodge_rate", "DODGE"],
  ["movement_speed", "SPD"]
];

const getErrorMessage = (error, fallback) => {
  return error?.response?.data?.message || error?.response?.data?.error || fallback;
};

const percent = (value, max) => {
  const nextMax = Math.max(1, Number(max || 1));
  return Math.max(0, Math.min(100, Math.round((Number(value || 0) / nextMax) * 100)));
};

function Meter({ label, value, max, tone = "green" }) {
  return (
    <div className={styles.meter}>
      <div className={styles.meterTop}>
        <span>{label}</span>
        <strong>{value}/{max}</strong>
      </div>
      <div className={styles.meterTrack}>
        <div className={`${styles.meterFill} ${styles[tone]}`} style={{ width: `${percent(value, max)}%` }} />
      </div>
    </div>
  );
}

function MiniList({ title, items, empty = "None" }) {
  const values = Array.isArray(items) ? items : [];
  return (
    <section className={styles.infoBlock}>
      <h3>{title}</h3>
      <div className={styles.tags}>
        {values.length ? values.slice(0, 8).map((item, index) => (
          <span key={`${typeof item === "string" ? item : item.key || item.name}-${index}`}>
            {typeof item === "string" ? item : item.name || item.key}
          </span>
        )) : <em>{empty}</em>}
      </div>
    </section>
  );
}

function SkillList({ title, items }) {
  const values = Array.isArray(items) ? items : [];
  return (
    <section className={styles.infoBlock}>
      <h3>{title}</h3>
      <div className={styles.skillList}>
        {values.length ? values.slice(0, 6).map((skill) => (
          <div className={styles.skillRow} key={skill.key || skill.name}>
            <span>{skill.name || skill.key}</span>
            <strong>Lv {skill.level || 1}</strong>
          </div>
        )) : <em>No skills learned.</em>}
      </div>
    </section>
  );
}

const Dashboard = () => {
  const [character, setCharacter] = useState(null);
  const [scene, setScene] = useState(null);
  const [messages, setMessages] = useState([]);
  const [actionText, setActionText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRpgState();
      setCharacter(data.character);
      setScene(data.scene);
      setMessages(data.scene ? [{ role: "narrator", text: data.scene.text }] : []);
    } catch (error) {
      if (error?.response?.status === 404) {
        setCharacter(null);
        setScene(null);
      } else {
        toast.error(getErrorMessage(error, "Failed to load reincarnation"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const start = async (restart = false) => {
    setSubmitting(true);
    try {
      const data = await startRpg({ restart });
      setCharacter(data.character);
      setScene(data.scene);
      setMessages([{ role: "narrator", text: data.scene?.text || "" }]);
      toast.success(restart ? "A new body awakens" : "Reincarnation started");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to start reincarnation"));
    } finally {
      setSubmitting(false);
    }
  };

  const act = async (nextAction) => {
    const trimmed = String(nextAction || "").trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setMessages((current) => [...current, { role: "player", text: trimmed }]);
    try {
      const data = await resolveRpgAction({ actionText: trimmed });
      setCharacter(data.character);
      setScene(data.scene);
      setMessages((current) => [...current, { role: "narrator", text: data.scene?.text || "" }]);
      setActionText("");
    } catch (error) {
      toast.error(getErrorMessage(error, "Action failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitTypedAction = (event) => {
    event.preventDefault();
    act(actionText);
  };

  const xpPercent = useMemo(() => percent(character?.xp, character?.xp_to_next), [character?.xp, character?.xp_to_next]);
  const title = character ? `${character.race_species} · Floor ${character.current_floor || 1}` : "Reincarnation";
  const choices = Array.isArray(scene?.choices) ? scene.choices : [];

  return (
    <div className={styles.page}>
      <Header floor={character?.current_floor || 1} title={title} />

      <main className={styles.content}>
        {loading ? (
          <section className={styles.emptyState}>
            <Activity size={28} />
            <p>Loading the current scene...</p>
          </section>
        ) : !character ? (
          <section className={styles.startPanel}>
            <span>Previous life terminated</span>
            <h1>You do not remember your name.</h1>
            <p>
              Something small opens its eyes in the dark. The first choice is not who you are.
              It is whether this new body survives long enough to become anything.
            </p>
            <button type="button" onClick={() => start(false)} disabled={submitting}>
              {submitting ? "Awakening..." : "Open your eyes"}
            </button>
          </section>
        ) : (
          <section className={styles.gameGrid}>
            <section className={styles.chatPanel} aria-label="Story chat">
              <div className={styles.chatHeader}>
                <div>
                  <span>{scene?.area || "Unknown floor"}</span>
                  <h1>{scene?.title || "The World Watches"}</h1>
                </div>
                <strong>Floor {character.current_floor || 1}/10</strong>
              </div>

              <div className={styles.chatLog}>
                <article className={styles.systemBubble}>
                  <span>System</span>
                  <p>Death confirmed. Memory damaged. Species reassigned: {character.race_species}.</p>
                </article>
                {messages.map((message, index) => (
                  <article className={message.role === "player" ? styles.playerBubble : styles.narratorBubble} key={`${message.role}-${index}`}>
                    <span>{message.role === "player" ? "You" : "Narrator"}</span>
                    <p>{message.text || "..."}</p>
                  </article>
                ))}
              </div>

              {!character.is_alive && (
                <button className={styles.rebirthButton} type="button" onClick={() => start(true)} disabled={submitting}>
                  {submitting ? "Reforming..." : "Reincarnate again"}
                </button>
              )}

              {character.is_alive && (
                <form className={styles.chatInput} onSubmit={submitTypedAction}>
                  <input
                    value={actionText}
                    onChange={(event) => setActionText(event.target.value)}
                    placeholder='Type your move, e.g. "I take the food and demand worship..."'
                    disabled={submitting}
                  />
                  <button type="submit" disabled={submitting || !actionText.trim()} aria-label="Send action">
                    <Send size={18} />
                  </button>
                </form>
              )}
            </section>

            <section className={styles.choicesPanel} aria-label="Choices">
              <div className={styles.panelHeader}>
                <span>Choose response</span>
                <strong>{submitting ? "Resolving" : "Waiting"}</strong>
              </div>
              <div className={styles.choiceList}>
                {choices.map((choice) => (
                  <button key={choice.key} type="button" onClick={() => act(choice.label)} disabled={submitting || !character.is_alive}>
                    <Swords size={18} />
                    <span>{choice.label}</span>
                    <small>{choice.detail}</small>
                  </button>
                ))}
              </div>
            </section>

            <aside className={styles.statusPanel} aria-label="Character status">
              <div className={styles.identityBlock}>
                <span>Character Sheet</span>
                <h2>{character.name || "Nameless"}</h2>
                <p>{character.race_species} · Evolution Stage {character.evolution_stage}</p>
              </div>

              <div className={styles.vitalsGrid}>
                <Meter label="HP" value={character.hp} max={character.max_hp} tone="red" />
                <Meter label="MP" value={character.mp} max={character.max_mp} tone="blue" />
                <Meter label="STA" value={character.stamina} max={character.max_stamina} tone="green" />
                <div className={styles.meter}>
                  <div className={styles.meterTop}><span>XP</span><strong>{xpPercent}%</strong></div>
                  <div className={styles.meterTrack}><div className={`${styles.meterFill} ${styles.gold}`} style={{ width: `${xpPercent}%` }} /></div>
                </div>
              </div>

              <div className={styles.resourceStrip}>
                <span><Heart size={15} /> Hunger <strong>{character.hunger}</strong></span>
                <span><Zap size={15} /> Soul <strong>{character.soul_level}</strong></span>
                <span><BookOpen size={15} /> Deaths <strong>{character.death_count}</strong></span>
              </div>

              <section className={styles.infoBlock}>
                <h3>Core Stats</h3>
                <div className={styles.statGrid}>
                  {CORE_STATS.map(([key, label]) => (
                    <div key={key}><span>{label}</span><strong>{character.stats?.[key] ?? 0}</strong></div>
                  ))}
                </div>
              </section>

              <section className={styles.infoBlock}>
                <h3>Combat</h3>
                <div className={styles.statGrid}>
                  {DERIVED_STATS.map(([key, label]) => (
                    <div key={key}>
                      <span>{label}</span>
                      <strong>{character.derived?.[key] ?? 0}{key.includes("rate") ? "%" : ""}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <SkillList title="Active Skills" items={character.active_skills} />
              <SkillList title="Passive Skills" items={character.passive_skills} />
              <MiniList title="Traits" items={character.traits} />
              <MiniList title="Titles" items={character.titles} />
              <MiniList title="Status Effects" items={character.status_effects} empty="Healthy" />

              <section className={styles.infoBlock}>
                <h3>Inventory</h3>
                <div className={styles.inventoryList}>
                  {(character.inventory || []).length ? character.inventory.slice(0, 8).map((item, index) => (
                    <div key={`${item.key}-${index}`}>
                      <span>{item.name}</span>
                      <strong>x{item.quantity}</strong>
                    </div>
                  )) : <em>Nothing carried.</em>}
                </div>
              </section>

              <section className={styles.infoBlock}>
                <h3>Quests</h3>
                <div className={styles.questList}>
                  {(character.quests || []).slice(0, 4).map((quest) => (
                    <div key={quest.key}>
                      <strong>{quest.name}</strong>
                      <span>{quest.status} · {quest.progress}/{quest.target}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.infoBlock}>
                <h3>Evolution</h3>
                <div className={styles.evolutionBox}>
                  <Shield size={16} />
                  <span>{character.evolution_progress?.essence || 0} essence</span>
                  <strong>{character.evolution_progress?.ready ? "Ready" : "Dormant"}</strong>
                </div>
              </section>
            </aside>
          </section>
        )}
      </main>

      <BottomNav />
    </div>
  );
};

export default Dashboard;
