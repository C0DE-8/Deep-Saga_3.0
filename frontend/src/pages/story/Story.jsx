import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BookOpen, RefreshCw, Star } from "lucide-react";
import BottomNav from "../../components/bottomNav/BottomNav";
import Header from "../../components/Header/header";
import { getChronicle, getStoryChapters } from "../../api/storyApi";
import styles from "./Story.module.css";

const getErrorMessage = (error, fallback = "Request failed") => {
  return error?.response?.data?.message || error?.response?.data?.error || fallback;
};

const Story = () => {
  const [events, setEvents] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStory = useCallback(async () => {
    setLoading(true);

    try {
      const [chronicleData, chapterData] = await Promise.all([
        getChronicle({ limit: 50 }),
        getStoryChapters()
      ]);

      const nextEvents = chronicleData.events || [];
      setEvents(nextEvents);
      setChapters(chapterData.chapters || []);
      setSelectedEvent((current) => current || nextEvents[0] || null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load Chronicle"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStory();
  }, [loadStory]);

  return (
    <div className={styles.page}>
      <Header floor={selectedEvent?.location?.floor ?? "J"} title="Chronicle" />

      <main className={styles.content}>
        {loading ? (
          <section className={styles.loading}>
            <RefreshCw size={28} />
            <p>Opening the Chronicle...</p>
          </section>
        ) : (
          <>
            <section className={styles.hero}>
              <BookOpen size={42} />
              <div>
                <h2>Story Archive</h2>
                <p>{events.length} recorded scenes across {chapters.length || 1} chapter{(chapters.length || 1) === 1 ? "" : "s"}</p>
              </div>
            </section>

            {!events.length ? (
              <section className={styles.emptyPanel}>
                <h3>No Chronicle entries yet</h3>
                <p>Resolve a dungeon action after running migration 006 to begin saving narrated scenes.</p>
              </section>
            ) : (
              <>
                {selectedEvent && (
                  <article className={styles.featured}>
                    <div className={styles.featuredMeta}>
                      <span>Chapter {selectedEvent.chapter_number}</span>
                      <span>{selectedEvent.event_type}</span>
                      {selectedEvent.is_legendary ? (
                        <span className={styles.legendary}>
                          <Star size={14} />
                          Legendary
                        </span>
                      ) : null}
                    </div>

                    <h2>{selectedEvent.title}</h2>
                    {selectedEvent.summary && <p className={styles.summary}>{selectedEvent.summary}</p>}
                    <p className={styles.narration}>{selectedEvent.narration}</p>

                    <div className={styles.eventFooter}>
                      <span>{selectedEvent.location?.area || "Unknown area"}</span>
                      <span>Y{selectedEvent.occurred_year} D{selectedEvent.occurred_day} H{selectedEvent.occurred_hour}</span>
                    </div>
                  </article>
                )}

                <section className={styles.timeline}>
                  {events.map((event) => (
                    <button
                      className={`${styles.eventCard} ${selectedEvent?.id === event.id ? styles.active : ""}`}
                      key={event.id}
                      type="button"
                      onClick={() => setSelectedEvent(event)}
                    >
                      <div>
                        <span>{event.event_type}</span>
                        <strong>{event.title}</strong>
                      </div>
                      <small>Ch. {event.chapter_number}</small>
                    </button>
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
};

export default Story;
