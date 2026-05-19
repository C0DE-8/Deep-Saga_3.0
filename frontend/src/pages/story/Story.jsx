import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [loading, setLoading] = useState(true);
  const latestSceneRef = useRef(null);

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
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load Chronicle"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStory();
  }, [loadStory]);

  useEffect(() => {
    if (loading || !events.length) return;

    requestAnimationFrame(() => {
      latestSceneRef.current?.scrollIntoView({
        block: "end"
      });
    });
  }, [events.length, loading]);

  const latestEvent = events[events.length - 1] || null;
  const books = useMemo(() => {
    const chapterDetails = new Map(chapters.map((chapter) => [Number(chapter.chapter_number), chapter]));
    const nextBooks = [];
    let currentBook = {
      number: 1,
      title: "Book 1",
      chapters: new Map()
    };

    function ensureChapter(book, event) {
      const chapterNumber = Number(event.chapter_number || 1);
      if (!book.chapters.has(chapterNumber)) {
        const chapter = chapterDetails.get(chapterNumber);
        book.chapters.set(chapterNumber, {
          chapter_number: chapterNumber,
          title: chapter?.title || `Chapter ${chapterNumber}`,
          summary: chapter?.summary || null,
          events: []
        });
      }

      return book.chapters.get(chapterNumber);
    }

    for (const event of events) {
      if (event.event_type === "reincarnation" && currentBook.chapters.size) {
        nextBooks.push(currentBook);
        const nextNumber = nextBooks.length + 1;
        currentBook = {
          number: nextNumber,
          title: `Book ${nextNumber}`,
          chapters: new Map()
        };
      }

      ensureChapter(currentBook, event).events.push(event);

      if (event.event_type === "death") {
        nextBooks.push(currentBook);
        const nextNumber = nextBooks.length + 1;
        currentBook = {
          number: nextNumber,
          title: `Book ${nextNumber}`,
          chapters: new Map()
        };
      }
    }

    if (currentBook.chapters.size || !nextBooks.length) {
      nextBooks.push(currentBook);
    }

    return nextBooks.map((book) => ({
      ...book,
      chapters: Array.from(book.chapters.values())
        .filter((chapter) => chapter.events.length)
        .sort((a, b) => Number(a.chapter_number) - Number(b.chapter_number))
    })).filter((book) => book.chapters.length);
  }, [chapters, events]);
  const latestEventId = latestEvent?.id;

  return (
    <div className={styles.page}>
      <Header floor={latestEvent?.location?.floor ?? "J"} title="Chronicle" />

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
                <section className={styles.book}>
                  {books.map((book) => (
                    <article className={styles.bookVolume} key={book.number}>
                      <header className={styles.bookHeader}>
                        <span>{book.title}</span>
                        <h2>{book.number === 1 ? "First Life" : "New Life"}</h2>
                      </header>

                      {book.chapters.map((chapter) => (
                        <section className={styles.chapter} key={`${book.number}-${chapter.chapter_number}`}>
                          <header className={styles.chapterHeader}>
                            <span>Chapter {chapter.chapter_number}</span>
                            <h2>{chapter.title}</h2>
                            {chapter.summary && <p>{chapter.summary}</p>}
                          </header>

                          {chapter.events.map((event, index) => (
                            <section
                              className={`${styles.scene} ${event.event_type === "death" ? styles.deathScene : ""} ${event.event_type === "reincarnation" ? styles.rebirthScene : ""}`}
                              key={event.id}
                              ref={event.id === latestEventId ? latestSceneRef : null}
                            >
                              <div className={styles.sceneMeta}>
                                <span>{event.event_type === "reincarnation" ? "Opening" : `Scene ${index + 1}`}</span>
                                <span>{event.event_type}</span>
                                {event.is_legendary ? (
                                  <span className={styles.legendary}>
                                    <Star size={14} />
                                    Legendary
                                  </span>
                                ) : null}
                              </div>

                              <h3>{event.title}</h3>
                              {event.summary && <p className={styles.summary}>{event.summary}</p>}
                              <p className={styles.narration}>{event.narration}</p>

                              <div className={styles.eventFooter}>
                                <span>{event.location?.area || "Unknown area"}</span>
                                <span>Y{event.occurred_year} D{event.occurred_day} H{event.occurred_hour}</span>
                              </div>
                            </section>
                          ))}
                        </section>
                      ))}
                    </article>
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
