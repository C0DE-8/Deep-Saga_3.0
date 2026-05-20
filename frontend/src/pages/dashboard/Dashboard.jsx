import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ChevronUp, Flag, Hourglass, Image as ImageIcon, Plus, Send, Sparkles } from "lucide-react";
import styles from "./Dashboard.module.css";
import BottomNav from "../../components/bottomNav/BottomNav";
import Header from "../../components/Header/header";
import { resolveAction } from "../../api/actionApi";
import { getAscensionStatus, submitFinalWish } from "../../api/ascensionApi";
import { getCurrentGame, startGame } from "../../api/gameApi";
import { getPlayerProfile, getPlayerSkills } from "../../api/playerApi";
import { getRebirthStatus, restartRebirth, submitRebirthWish } from "../../api/rebirthApi";
import { getCurrentWorld, resolveWorldAction, startWorld } from "../../api/worldApi";

const getErrorMessage = (error, fallback = "Something went wrong") => {
  return error?.response?.data?.message || error?.response?.data?.error || fallback;
};

const normalizeNarration = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.narration === "string") return value.narration;
  if (typeof value.text === "string") return value.text;
  return JSON.stringify(value, null, 2);
};

const makeSceneFromWorld = (data) => {
  const state = data?.world_state || {};

  return {
    title: state.region_name || state.location || "World Mode",
    text: normalizeNarration(data?.narration) || state.summary || state.description || data?.outcome || "The world waits for your next action.",
    type: "world",
    choices: data?.choices || [],
    can_type: true
  };
};

const makeWorldMeta = (data) => {
  const state = data?.world_state || {};

  return {
    floor: "W",
    area: state.region_name || state.location || state.world_name || "World",
    time_of_day: state.era || state.phase || "world"
  };
};

const getEnemyMembers = (enemy) => {
  return Array.isArray(enemy?.members) ? enemy.members.filter((member) => !member.is_defeated) : [];
};

const Dashboard = () => {
  const [scene, setScene] = useState(null);
  const [world, setWorld] = useState(null);
  const [player, setPlayer] = useState(null);
  const [skills, setSkills] = useState([]);
  const [enemy, setEnemy] = useState(null);
  const [boss, setBoss] = useState(null);
  const [battle, setBattle] = useState(null);
  const [eventFeedback, setEventFeedback] = useState(null);
  const [mode, setMode] = useState("dungeon");
  const [actionText, setActionText] = useState("");
  const [wishText, setWishText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [canRebirthWish, setCanRebirthWish] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refreshPlayer = useCallback(async () => {
    const [profileData, skillData, rebirthData, ascensionData] = await Promise.allSettled([
      getPlayerProfile(),
      getPlayerSkills(),
      getRebirthStatus(),
      getAscensionStatus()
    ]);

    if (profileData.status === "fulfilled") setPlayer(profileData.value.player);
    if (skillData.status === "fulfilled") setSkills(skillData.value.skills || []);

    if (rebirthData.status === "fulfilled") {
      setCanRebirthWish(!!rebirthData.value.can_rebirth_wish);
    }

    if (rebirthData.status === "fulfilled" && !rebirthData.value.is_alive) {
      setMode("death");
      setStatusText(
        rebirthData.value.can_rebirth_wish
          ? "This life has ended. Be reborn, or spend your completed-level wish."
          : rebirthData.value.wish_requirement || "This life has ended. Be reborn to continue."
      );
    } else if (ascensionData.status === "fulfilled" && ascensionData.value.awaiting_final_wish) {
      setMode("ascension");
      setStatusText(ascensionData.value.prompt || "State your wish.");
    }
  }, []);

  const loadGame = useCallback(async () => {
    setLoading(true);

    try {
      await refreshPlayer();

      try {
        const gameData = await getCurrentGame();
        setScene(gameData.scene);
        setWorld(gameData.world);
        setEnemy(gameData.enemy || null);
        setBoss(gameData.boss || null);
        setBattle(gameData.battle || gameData.event_feedback?.combat || null);
        setEventFeedback(gameData.event_feedback || null);
        if (gameData.player?.is_alive === 0 || gameData.scene?.type === "death") {
          setMode("death");
          setStatusText(canRebirthWish ? "This life has ended. Be reborn, or use your earned wish." : "This life has ended. Be reborn to continue.");
        } else if (gameData.scene?.type === "ascension") {
          setMode("ascension");
          setStatusText(gameData.message || "State your wish.");
        } else {
          setMode("dungeon");
          setStatusText(gameData.message || "");
        }
        return;
      } catch (currentError) {
        if (currentError?.response?.status !== 404) throw currentError;
      }

      try {
        const worldData = await getCurrentWorld();
        setScene(makeSceneFromWorld(worldData));
        setWorld(makeWorldMeta(worldData));
        setEnemy(null);
        setBoss(null);
        setBattle(null);
        setEventFeedback(null);
        setMode("world");
        setStatusText("World Mode");
        return;
      } catch (worldError) {
        if (worldError?.response?.status !== 404) throw worldError;
      }

      const started = await startGame();
      setScene(started.scene);
      setWorld(started.world);
      setEnemy(started.enemy || null);
      setBoss(started.boss || null);
      setBattle(started.battle || started.event_feedback?.combat || null);
      setEventFeedback(started.event_feedback || null);
      setMode("dungeon");
      setStatusText("");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load game"));
    } finally {
      setLoading(false);
    }
  }, [canRebirthWish, refreshPlayer]);

  useEffect(() => {
    loadGame();
  }, [loadGame]);

  const applyGameResponse = useCallback((data) => {
    if (data.scene) setScene(data.scene);
    if (data.world) setWorld(data.world);
    if (data.player) setPlayer((current) => ({ ...current, ...data.player }));

    setEnemy(data.enemy || null);
    setBoss(data.boss || null);
    setBattle(data.battle || data.event_feedback?.combat || null);
    setEventFeedback(data.event_feedback || null);

    if (data.final_ascension) {
      setMode("ascension");
      setStatusText(data.final_ascension.prompt || "State your wish.");
    } else if (data.player?.is_alive === 0) {
      setMode("death");
      setStatusText(canRebirthWish ? "This life has ended. Be reborn, or use your earned wish." : "This life has ended. Be reborn to continue.");
    } else {
      setMode("dungeon");
      setStatusText(data.message || "");
    }
  }, [canRebirthWish]);

  const submitDungeonAction = async (value) => {
    const nextAction = String(value || "").trim();
    if (!nextAction || submitting) return;

    setSubmitting(true);
    try {
      const data = await resolveAction(nextAction);
      applyGameResponse(data);
      setActionText("");
      await refreshPlayer();
    } catch (error) {
      toast.error(getErrorMessage(error, "Action failed"));

      if (error?.response?.data?.mode === "world") {
        const worldData = await getCurrentWorld();
        setScene(makeSceneFromWorld(worldData));
        setWorld(makeWorldMeta(worldData));
        setMode("world");
      } else if (error?.response?.data?.ascension) {
        setMode("ascension");
        setStatusText(error.response.data.prompt || "State your wish.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitWorldAction = async (value) => {
    const nextAction = String(value || "").trim();
    if (!nextAction || submitting) return;

    setSubmitting(true);
    try {
      const data = await resolveWorldAction(nextAction);
      setScene(makeSceneFromWorld(data));
      setWorld(makeWorldMeta(data));
      setActionText("");
      setStatusText(data.message || "World action resolved");
    } catch (error) {
      toast.error(getErrorMessage(error, "World action failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitWish = async () => {
    const wish = wishText.trim();
    if (!wish || submitting) return;

    setSubmitting(true);
    try {
      const data = mode === "death" ? await submitRebirthWish(wish) : await submitFinalWish(wish);
      setWishText("");

      if (mode === "death") {
        toast.success(data.message || "Rebirth complete");
        await loadGame();
        return;
      }

      setScene(makeSceneFromWorld(data));
      setWorld(makeWorldMeta(data));
      setMode("world");
      setStatusText(data.message || "World Mode initialized");
      await refreshPlayer();
    } catch (error) {
      toast.error(getErrorMessage(error, "Wish failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const restartLife = async () => {
    if (submitting) return;

    setSubmitting(true);
    try {
      const data = await restartRebirth();
      toast.success(data.message || "Restarted");
      await startGame();
      await loadGame();
    } catch (error) {
      toast.error(getErrorMessage(error, "Restart failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const enterWorldMode = async () => {
    if (submitting) return;

    setSubmitting(true);
    try {
      const data = await startWorld();
      setScene(makeSceneFromWorld(data));
      setWorld(makeWorldMeta(data));
      setMode("world");
      setStatusText(data.message || "World Mode");
    } catch (error) {
      toast.error(getErrorMessage(error, "World Mode unavailable"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCurrentAction = (event) => {
    event.preventDefault();
    if (mode === "world") submitWorldAction(actionText);
    else submitDungeonAction(actionText);
  };

  const title = mode === "world" ? "World Mode" : scene?.type === "ascension" ? "Ascension" : "Deep Saga";
  const floor = world?.floor ?? player?.current_floor ?? 1;
  const choices = Array.isArray(scene?.choices) ? scene.choices : [];
  const activeThreat = boss || enemy;
  const enemyMembers = getEnemyMembers(activeThreat);
  const biomeHazard = activeThreat?.biome_hazard;
  const corpseState = eventFeedback?.corpse_state || null;
  const hazardState = eventFeedback?.hazard_state || corpseState?.hazard_state || null;
  const postCombatDamage = eventFeedback?.post_combat_damage || null;
  const inactiveEncounter = eventFeedback?.encounter_disengaged || eventFeedback?.combat?.encounter_disengaged
    ? {
        state: eventFeedback?.encounter_state || eventFeedback?.combat?.encounter_state || "disengaged",
        reason: eventFeedback?.encounter_sync?.reason || eventFeedback?.combat?.disengagement?.reason || "Active combat pressure ended.",
        enemyHpVisible: eventFeedback?.encounter_sync?.enemy_hp_visible === true,
        combatMode: eventFeedback?.encounter_sync?.combat_mode === true
      }
    : null;
  const hasCorpseState = !!corpseState && !activeThreat;
  const hasHazardWarning = !!hazardState?.active || eventFeedback?.world_reaction?.code === "corpse_hazard_warning";
  const hasResidualEvent = eventFeedback?.world_reaction?.code === "corpse_hazard" || !!postCombatDamage;
  const hazardCategory = hazardState?.category || eventFeedback?.world_reaction?.category || postCombatDamage?.classification;
  const healthPercent = useMemo(() => {
    const hp = Number(player?.hp || 0);
    const maxHp = Number(player?.max_hp || 1);
    return Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
  }, [player?.hp, player?.max_hp]);

  return (
    <div className={styles.page}>
      <Header floor={floor} title={title} />

      <div className={styles.content}>
        <section className={styles.statsCard}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Experience</span>
            <span className={styles.statValue}>{player?.exp ?? 0}</span>
            {!!player?.stat_points && (
              <span className={styles.plusIcon} title={`${player.stat_points} stat points available`}>
                <Plus size={18} />
              </span>
            )}
          </div>

          <div className={styles.statItem}>
            <span className={styles.statLabel}>Health</span>
            <span className={styles.statValue}>{player?.hp ?? 0}/{player?.max_hp ?? 0}</span>
          </div>
        </section>

        <div className={styles.healthTrack} aria-label={`Health ${healthPercent}%`}>
          <div className={styles.healthFill} style={{ width: `${healthPercent}%` }} />
        </div>

        <section className={styles.metaGrid}>
          <span>{player?.name || "Nameless"}</span>
          <span>{player?.current_race || "Unknown race"}</span>
          <span>{world?.time_of_day || player?.time_of_day || "night"}</span>
          <span>{world?.area || player?.current_area || "Dungeon"}</span>
        </section>

        {statusText && <p className={styles.statusText}>{statusText}</p>}

        {loading ? (
          <section className={styles.loadingPanel}>
            <Sparkles size={28} />
            <p>Loading the current scene...</p>
          </section>
        ) : (
          <>
            <section className={styles.storyHeader}>
              <button className={styles.chevronButton} type="button" aria-label="Collapse scene">
                <ChevronUp size={28} />
              </button>

              <div className={styles.storyHeaderCenter}>
                <h2 className={styles.storyMode}>{scene?.type || mode}</h2>
              </div>

              <button className={`${styles.iconButton} ${styles.storyImageButton}`} type="button" aria-label="Scene image">
                <ImageIcon size={28} />
              </button>
            </section>

            <h3 className={styles.locationTitle}>{scene?.title || "No Active Scene"}</h3>

            <section className={styles.storySection}>
              <p className={styles.storyText}>
                {normalizeNarration(scene?.text) || "Start the game to open the first scene."}
              </p>

              <div className={styles.flagWrap}>
                <button className={styles.flagButton} type="button" aria-label="Mark scene">
                  <Flag size={24} />
                </button>
              </div>
            </section>

            {activeThreat && (
              <section className={styles.threatPanel}>
                <div>
                  <span className={styles.threatLabel}>
                    {activeThreat.rank_tier || (boss ? "Boss" : "Enemy")}
                  </span>
                  <strong>{activeThreat.name}</strong>
                  <small>{activeThreat.description}</small>
                  <div className={styles.threatMeta}>
                    {activeThreat.faction_key && <span>{activeThreat.faction_key}</span>}
                    {activeThreat.elemental_affinity && <span>{activeThreat.elemental_affinity}</span>}
                    {activeThreat.encounter_role && <span>{activeThreat.encounter_role}</span>}
                  </div>
                </div>
                <span>{activeThreat.hp}/{activeThreat.max_hp}</span>
              </section>
            )}

            {hasCorpseState && (
              <section className={styles.remainsPanel}>
                <div>
                  <span>Remains</span>
                  <strong>{corpseState.enemy_name || "Defeated enemy"}</strong>
                  {corpseState.description && <p>{corpseState.description}</p>}
                </div>
                <em>{corpseState.enemy_state || "defeated"}</em>
              </section>
            )}

            {inactiveEncounter && !activeThreat && (
              <section className={styles.inactiveEncounterPanel}>
                <div>
                  <span>Inactive Encounter</span>
                  <strong>{inactiveEncounter.state.replace(/_/g, " ")}</strong>
                  <p>{inactiveEncounter.reason}</p>
                </div>
                <em>{inactiveEncounter.combatMode ? "combat" : "tracking"}</em>
              </section>
            )}

            {!!enemyMembers.length && (
              <section className={styles.encounterPanel}>
                <div className={styles.panelHeader}>
                  <span>Encounter</span>
                  <strong>{enemyMembers.length} active</strong>
                </div>
                <div className={styles.enemyList}>
                  {enemyMembers.slice(0, 6).map((member) => (
                    <div className={styles.enemyRow} key={member.id || `${member.enemy_key}-${member.position_index}`}>
                      <div>
                        <strong>{member.display_name || member.enemy_key}</strong>
                        <span>{member.role_key || member.rank_tier || "enemy"}</span>
                      </div>
                      <span>{member.hp}/{member.max_hp}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {biomeHazard && (
              <section className={styles.hazardPanel}>
                <span>Hazard</span>
                <strong>{biomeHazard.name || biomeHazard.hazard_key}</strong>
                {biomeHazard.description && <p>{biomeHazard.description}</p>}
              </section>
            )}

            {hasHazardWarning && (
              <section className={styles.corpseHazardPanel}>
                <span>Corpse Hazard</span>
                <strong>{hazardCategory || "unstable remains"}</strong>
                <p>{hazardState?.warning || "The remains may react if disturbed."}</p>
              </section>
            )}

            {hasResidualEvent && (
              <section className={styles.residualPanel}>
                <span>Residual Event</span>
                <strong>{hazardCategory || "environmental backlash"}</strong>
                <p>
                  {postCombatDamage?.amount
                    ? `Took ${postCombatDamage.amount} from ${postCombatDamage.classification || "unstable remains"}.`
                    : eventFeedback?.world_reaction?.warning || "The remains discharged lingering danger."}
                </p>
              </section>
            )}

            {battle && (
              <section className={styles.battlePanel}>
                {eventFeedback?.combat ? (
                  <>
                    <div className={styles.battleDetail}>
                      <strong>{eventFeedback.combat.player_attempt}</strong>
                      {eventFeedback.combat.target_member?.display_name && (
                        <span>Targeted {eventFeedback.combat.target_member.display_name}</span>
                      )}
                      {eventFeedback.combat.enemy_reaction_code && <span>{eventFeedback.combat.enemy_reaction_code}</span>}
                    </div>
                    <div className={styles.battleStats}>
                      <span>Dealt {battle.player_damage_dealt ?? 0}</span>
                      <span>Took {battle.enemy_damage_dealt ?? 0}</span>
                      <span>{battle.defeated ? "defeated" : `${battle.remaining_enemy_count ?? activeThreat?.count ?? 0} left`}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span>Dealt {battle.player_damage_dealt ?? 0}</span>
                    <span>Took {battle.enemy_damage_dealt ?? 0}</span>
                    <span>{battle.result_tag || "battle"}</span>
                  </>
                )}
              </section>
            )}

            {mode === "death" || mode === "ascension" ? (
              <section className={styles.wishPanel}>
                {mode === "death" && (
                  <button className={styles.primaryButton} type="button" onClick={restartLife} disabled={submitting}>
                    {submitting ? "Rebirthing..." : "Be Reborn"}
                  </button>
                )}
                {(mode === "ascension" || canRebirthWish) && (
                  <>
                    <input
                      className={styles.wishInput}
                      type="text"
                      value={wishText}
                      maxLength={mode === "death" ? 240 : 1000}
                      onChange={(event) => setWishText(event.target.value)}
                      placeholder={mode === "death" ? "Earned rebirth wish..." : "State your final wish..."}
                    />
                    <button className={mode === "death" ? styles.secondaryButton : styles.primaryButton} type="button" onClick={submitWish} disabled={submitting || !wishText.trim()}>
                      {submitting ? "Sending..." : "Send Wish"}
                    </button>
                  </>
                )}
                {mode === "ascension" && (
                  <button className={styles.secondaryButton} type="button" onClick={enterWorldMode} disabled={submitting}>
                    Enter World Mode
                  </button>
                )}
              </section>
            ) : (
              <>
                {!!choices.length && (
                  <section className={styles.choicesSection}>
                    {choices.map((choice, index) => (
                      <button
                        key={`${choice}-${index}`}
                        className={styles.choiceCard}
                        type="button"
                        onClick={() => mode === "world" ? submitWorldAction(choice) : submitDungeonAction(choice)}
                        disabled={submitting}
                      >
                        {choice}
                      </button>
                    ))}
                  </section>
                )}

                <div className={styles.dividerWrap}>
                  <div className={styles.divider} />
                </div>

                <form className={styles.inputSection} onSubmit={submitCurrentAction}>
                  <div className={styles.inputBox}>
                    <button className={styles.inputIcon} type="button" aria-label="Typed action">
                      <span className={styles.keyboardIcon}>⌨</span>
                    </button>

                    <input
                      className={styles.input}
                      type="text"
                      value={actionText}
                      onChange={(event) => setActionText(event.target.value)}
                      placeholder={mode === "world" ? "Act in the new world..." : "Or something else..."}
                      disabled={submitting}
                    />

                    <button className={styles.sendButton} type="submit" disabled={submitting || !actionText.trim()} aria-label={submitting ? "Resolving action" : "Send action"}>
                      {submitting ? <Hourglass className={styles.spinIcon} size={20} /> : <Send size={20} />}
                    </button>
                  </div>
                </form>
              </>
            )}

            {!!skills.length && (
              <section className={styles.skillsRow}>
                {skills.slice(0, 4).map((skill) => (
                  <span key={skill.skill_key || skill.id || skill.name}>
                    {skill.name || skill.skill_key}
                  </span>
                ))}
              </section>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

export default Dashboard;
