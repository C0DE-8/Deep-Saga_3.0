import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Activity, BookOpen, Heart, Swords, Zap } from "lucide-react";
import BottomNav from "../../components/bottomNav/BottomNav";
import Header from "../../components/Header/header";
import { getRpgState, resolveRpgAction, startRpg } from "../../api/rpgApi";
import styles from "./Dashboard.module.css";

const CORE_STATS = [
  ["strength", "Strength"],
  ["agility", "Agility"],
  ["vitality", "Vitality"],
  ["intelligence", "Intelligence"],
  ["wisdom", "Wisdom"],
  ["resolve", "Resolve"],
  ["dexterity", "Dexterity"],
  ["perception", "Perception"],
  ["luck", "Luck"],
  ["charisma", "Charisma"]
];

const DERIVED_STATS = [
  ["defense", "Defense"],
  ["magic_attack", "Magic Attack"],
  ["magic_defense", "Magic Defense"],
  ["critical_rate", "Critical Rate"],
  ["dodge_rate", "Dodge Rate"],
  ["movement_speed", "Movement Speed"]
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

function TagList({ title, items, empty = "None yet" }) {
  const values = Array.isArray(items) ? items : [];
  return (
    <section className={styles.panel}>
      <h3>{title}</h3>
      <div className={styles.tags}>
        {values.length ? values.map((item, index) => (
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
    <section className={styles.panel}>
      <h3>{title}</h3>
      <div className={styles.skillList}>
        {values.length ? values.map((skill) => (
          <div className={styles.skillRow} key={skill.key || skill.name}>
            <div>
              <strong>{skill.name || skill.key}</strong>
              <span>{skill.source || skill.cost_type || "earned through action"}</span>
            </div>
            <small>Lv {skill.level || 1} · {skill.xp || 0} XP</small>
          </div>
        )) : <em>No skills learned.</em>}
      </div>
    </section>
  );
}

const Dashboard = () => {
  const [character, setCharacter] = useState(null);
  const [scene, setScene] = useState(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRpgState();
      setCharacter(data.character);
      setScene(data.scene);
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
      const data = await startRpg({ name, restart });
      setCharacter(data.character);
      setScene(data.scene);
      toast.success(restart ? "New body awakened" : "Reincarnation started");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to start reincarnation"));
    } finally {
      setSubmitting(false);
    }
  };

  const act = async (actionKey) => {
    setSubmitting(true);
    try {
      const data = await resolveRpgAction({ actionKey });
      setCharacter(data.character);
      setScene(data.scene);
    } catch (error) {
      toast.error(getErrorMessage(error, "Action failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const xpPercent = useMemo(() => percent(character?.xp, character?.xp_to_next), [character?.xp, character?.xp_to_next]);
  const title = character ? `${character.race_species} · Floor ${character.current_floor || 1}` : "Monster Reincarnation";

  return (
    <div className={styles.page}>
      <Header floor={character?.current_floor || 1} title={title} />

      <main className={styles.content}>
        {loading ? (
          <section className={styles.emptyState}>
            <Activity size={28} />
            <p>Loading this reincarnation...</p>
          </section>
        ) : !character ? (
          <section className={styles.startPanel}>
            <span>Previous Life Ended</span>
            <h1>Wake as a weak monster and survive.</h1>
            <p>
              Your first species is random. Survive the descent through 10 floors,
              and earn skills from what you do, survive, discover, and become.
            </p>
            <div className={styles.startForm}>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Character name" />
              <button type="button" onClick={() => start(false)} disabled={submitting}>
                Start Reincarnation
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className={styles.heroGrid}>
              <div className={styles.scenePanel}>
                <span>{scene?.area || "Unknown wilds"}</span>
                <h1>{scene?.title || "The World Watches"}</h1>
                <p>{scene?.text || "Choose how this body survives."}</p>
                {!character.is_alive && (
                  <button className={styles.restartButton} type="button" onClick={() => start(true)} disabled={submitting}>
                    Reincarnate Again
                  </button>
                )}
              </div>

              <aside className={styles.identityPanel}>
                <span>Character Sheet</span>
                <h2>{character.name}</h2>
                <dl>
                  <div><dt>Race/Species</dt><dd>{character.race_species}</dd></div>
                  <div><dt>Evolution Stage</dt><dd>{character.evolution_stage}</dd></div>
                  <div><dt>Floor</dt><dd>{character.current_floor || 1}/10</dd></div>
                  <div><dt>Level</dt><dd>{character.level}</dd></div>
                  <div><dt>XP</dt><dd>{character.xp}/{character.xp_to_next}</dd></div>
                  <div><dt>Soul Level</dt><dd>{character.soul_level}</dd></div>
                  <div><dt>Deaths</dt><dd>{character.death_count}</dd></div>
                  <div><dt>Reincarnations</dt><dd>{character.reincarnation_count}</dd></div>
                </dl>
              </aside>
            </section>

            <section className={styles.metersGrid}>
              <Meter label="Health" value={character.hp} max={character.max_hp} tone="red" />
              <Meter label="Mana" value={character.mp} max={character.max_mp} tone="blue" />
              <Meter label="Stamina" value={character.stamina} max={character.max_stamina} tone="green" />
              <div className={styles.meter}>
                <div className={styles.meterTop}><span>Experience</span><strong>{xpPercent}%</strong></div>
                <div className={styles.meterTrack}><div className={`${styles.meterFill} ${styles.gold}`} style={{ width: `${xpPercent}%` }} /></div>
              </div>
              <div className={styles.resourceCard}><Heart size={18} /> Hunger <strong>{character.hunger}</strong></div>
              <div className={styles.resourceCard}><Zap size={18} /> Currency <strong>{character.currency}</strong></div>
              <div className={styles.resourceCard}><BookOpen size={18} /> Reputation <strong>{character.reputation}</strong></div>
            </section>

            <section className={styles.choiceGrid}>
              {(scene?.choices || []).map((choice) => (
                <button key={choice.key} type="button" onClick={() => act(choice.key)} disabled={submitting || !character.is_alive}>
                  <Swords size={18} />
                  <strong>{choice.label}</strong>
                  <span>{choice.detail}</span>
                </button>
              ))}
            </section>

            <section className={styles.sheetGrid}>
              <section className={styles.panel}>
                <h3>Core Stats</h3>
                <div className={styles.statGrid}>
                  {CORE_STATS.map(([key, label]) => (
                    <div key={key}><span>{label}</span><strong>{character.stats?.[key] ?? 0}</strong></div>
                  ))}
                </div>
              </section>

              <section className={styles.panel}>
                <h3>Combat Stats</h3>
                <div className={styles.statGrid}>
                  {DERIVED_STATS.map(([key, label]) => (
                    <div key={key}><span>{label}</span><strong>{character.derived?.[key] ?? 0}{key.includes("rate") ? "%" : ""}</strong></div>
                  ))}
                </div>
              </section>

              <SkillList title="Active Skills" items={character.active_skills} />
              <SkillList title="Passive Skills" items={character.passive_skills} />
              <TagList title="Traits" items={character.traits} />
              <TagList title="Titles" items={character.titles} />
              <TagList title="Status Effects" items={character.status_effects} empty="Healthy" />

              <section className={styles.panel}>
                <h3>Inventory & Equipment</h3>
                <div className={styles.inventoryList}>
                  {(character.inventory || []).length ? character.inventory.map((item, index) => (
                    <div key={`${item.key}-${index}`}>
                      <span>{item.name}</span>
                      <strong>x{item.quantity}</strong>
                    </div>
                  )) : <em>Nothing carried.</em>}
                </div>
                <div className={styles.equipmentLine}>
                  Weapon: {character.equipment?.weapon || "none"} · Armor: {character.equipment?.armor || "none"}
                </div>
              </section>

              <section className={styles.panel}>
                <h3>Quests</h3>
                <div className={styles.questList}>
                  {(character.quests || []).map((quest) => (
                    <div key={quest.key}>
                      <strong>{quest.name}</strong>
                      <span>{quest.description}</span>
                      <small>{quest.status} · {quest.progress}/{quest.target} · {quest.reward}</small>
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.panel}>
                <h3>Evolution Progress</h3>
                <div className={styles.evolutionBox}>
                  <strong>{character.evolution_progress?.essence || 0} essence</strong>
                  <span>{character.evolution_progress?.ready ? "Evolution pressure is ready." : "Conditions are still incomplete."}</span>
                  <div className={styles.tags}>
                    {(character.evolution_progress?.conditions || []).map((condition) => <span key={condition}>{condition}</span>)}
                  </div>
                </div>
              </section>

              <TagList title="Relationships" items={character.relationships} empty="No bonds formed." />
              <TagList title="Achievements" items={character.achievements} empty="No achievements yet." />
            </section>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
};

export default Dashboard;
