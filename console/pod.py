""" Podcast downloader app. Search and download podcasts to your library

Usage:
    pod.py search <regex>
    pod.py list
    pod.py import <rss>
    pod.py add <iTunes>
    pod.py delete <id>
    pod.py fetch
    pod.py fetch <id>
    pod.py download
    pod.py podcast <id> suspend
    pod.py podcast <id> continue
    pod.py podcast <id> download

Options:
  -h --help     Show this screen.
"""
from jaraco.docker import is_docker
from docopt import docopt
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib import request
from time import time
from rich.console import Console
from rich.table import Table
import requests
import feedparser
import sqlite3
import os
import shutil
import re
import unidecode
import eyed3
import httpx

console = Console()


def createDatabase(conn):
    cur = conn.cursor()

    cur.execute("""
     CREATE TABLE IF NOT EXISTS podcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, title text, artist text, genre text, rss_url text, image_url text, itunes_id int, date int, suspended int);
    """)

    cur.execute("""
       CREATE TABLE IF NOT EXISTS podcasts_items (id INTEGER PRIMARY KEY AUTOINCREMENT, track_id int, podcast_id int, guid text, title text, desc text, keywords text, author text, media_url text, image_url text, publish_date int, filename text, downloaded int);
    """)

    pass

def safe_filename(name: str) -> str:
    """Create a filesystem-safe filename from a string.

    Keeps alphanumerics, dot, dash and underscore. Collapses whitespace.
    """
    name = re.sub(r"\s+", "-", name.strip())
    name = re.sub(r"[^A-Za-z0-9.\-_]", "", name)
    return name[:240]

def download_one(client: httpx.Client, url: str, dest: Path, chunk_size: int = 32_768) -> None:
    with httpx.Client(follow_redirects=True) as client:
        with client.stream("GET", url, timeout=60.0) as resp:
            resp.raise_for_status()
            with dest.open("wb") as fh:
                for chunk in resp.iter_bytes(chunk_size=chunk_size):
                    if chunk:
                        fh.write(chunk)

def getCategories(tags):
    cat = []
    for tag in tags:
        cat.append(tag.term)
    return ', '.join(cat)


def searchTunes(text: str):
    url = f"https://itunes.apple.com/search?term={text}&entity=podcast"
    response = requests.get(url)

    with response as r:
        if r.status_code == 200:
            request = r.json()

            if int(request['resultCount']) == 0:
                console.print("[yellow]Important:[/yellow] Nothing to show.")
            else:
                table = Table(show_header=True, header_style="bold magenta")
                table.add_column("Id", style="dim", width=10)
                table.add_column("Title")
                table.add_column("Artist")
                table.add_column("Genre")

                for result in request['results']:
                    table.add_row(str(result['collectionId']),
                                  str(result['collectionName']),
                                  str(result['artistName']),
                                  str(result['primaryGenreName']))

                console.print(table)
    pass


def isRssImported(conn, rss, itunes_id=None):
    cur = conn.cursor()
    if itunes_id is None:
        cur.execute("""
            SELECT COUNT(id) AS Total FROM podcasts WHERE rss_url = ? AND itunes_id = 0
        """, (rss,))
    else:
        cur.execute("""
            SELECT COUNT(id) AS Total FROM podcasts WHERE rss_url = ? AND itunes_id = ?
        """, (rss, itunes_id))

    return False if int(cur.fetchone()[0]) == 0 else True


def importRssFeed(conn, rss):
    if not isRssImported(conn, rss):
        if not rss.startswith("http"):
            if not os.path.exists(rss):
                console.print(f"[red]Error:[/red] File '{rss}' not exists.")
                return
        parsed = feedparser.parse(rss)
        feed = getattr(parsed, 'feed', None)
        if feed is None:
            console.print(f"[red]Error:[/red] Unable to parse RSS feed: {rss}")
            return
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO podcasts (title, artist, genre, rss_url, image_url, itunes_id, date, suspended) VALUES (?, ?, ?, ?, ?, ?, ?, 0);
        """, (feed.title, feed.author_detail.name, getCategories(feed.tags), rss, feed.image.url, 0, time()))

        inserted_id = cur.lastrowid
        fetchPodcastItems(conn, inserted_id)

        try:
            conn.commit()
        except sqlite3.Error as e:
            conn.rollback()
            console.print("[red]Error:[/red] Can't create podcast entry in queue.")

    pass


def addPodcast(conn, id):
    url = f"https://itunes.apple.com/lookup?id={id}"
    response = requests.get(url)

    with response as r:
        if r.status_code == 200:
            request = r.json()

            if int(request['resultCount']) == 1:
                podcast = request['results'][0]

                if not isRssImported(conn, podcast["feedUrl"], id):
                    cur = conn.cursor()
                    cur.execute("""
                      INSERT INTO podcasts (title, artist, genre, rss_url, image_url, itunes_id, date, suspended) VALUES (?, ?, ?, ?, ?, ?, ?, 0);
                    """, (podcast["collectionName"],
                          podcast["artistName"],
                          podcast["primaryGenreName"],
                          podcast["feedUrl"],
                          podcast["artworkUrl600"],
                          id, time()))

                    inserted_id = cur.lastrowid
                    fetchPodcastItems(conn, inserted_id)

                    try:
                        conn.commit()
                    except sqlite3.Error as e:
                        conn.rollback()
                        console.print("[red]Error:[/red] Can't create podcast entry in queue.")

                    return inserted_id
    return 0


def listPodcasts(conn):
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT id, title, artist, genre, date, itunes_id FROM podcasts ORDER BY title
    """)

    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Id", style="dim", width=10)
    table.add_column("Date", width=10)
    table.add_column("Title")
    table.add_column("Artist")
    table.add_column("Genre")

    for row in rows:
        podcast_id = int(row[0])
        podcast_title = str(row[1])
        podcast_artist = str(row[2])
        podcast_genre = str(row[3])
        inserted_date = datetime.utcfromtimestamp(int(row[4])).strftime('%Y-%m-%d')
        table.add_row(str(podcast_id), inserted_date, podcast_title, podcast_artist, podcast_genre)

    console.print(table)
    pass


def suspendPodcast(conn, id, suspend):
    cur = conn.cursor()
    cur.execute("""
        UPDATE podcasts SET suspended = ? WHERE id = ?
   """, (0 if suspend is False else 1, id,))

    try:
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        console.print("[red]Error:[/red] Can't update podcast entry.")

    pass


def deletePodcast(conn, id):
    cur = conn.cursor()
    cur.execute("""
        DELETE FROM podcasts_items WHERE podcast_id = ?
    """, (id,))

    cur.execute("""
        DELETE FROM podcasts WHERE id = ?
    """, (id,))

    try:
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        console.print("[red]Error:[/red] Can't delete podcast entries.")

    pass


def fetchAllItems(conn):
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT id FROM podcasts
    """)

    for row in rows:
        podcast_id = int(row[0])
        fetchPodcastItems(conn, str(podcast_id))

    pass


def fetchPodcastItems(conn, podcastId):
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT id, title, rss_url, artist, genre, image_url FROM podcasts WHERE id = ?
    """, (podcastId,))

    for row in rows:
        podcast_id = int(row[0])
        podcast_title = str(row[1])
        rss_url = str(row[2])
        podcast_artist = str(row[3])
        podcast_genre = str(row[4])
        podcast_image_url = str(row[5])
        feed = feedparser.parse(rss_url)

        for entry in feed.entries:
            if not itemIsFetched(conn, entry.guid):
                author = podcast_artist if not hasattr(entry, "author") else entry.author
                tags = podcast_genre if not hasattr(entry, 'tags') else getCategories(entry.tags)
                image = podcast_image_url if not hasattr(entry, 'image') else entry.image.href
                media_url = "" if len(entry.enclosures) == 0 else entry.enclosures[0].href
                published_date = entry.published_parsed
                _time = datetime(published_date.tm_year, published_date.tm_mon, published_date.tm_mday).timestamp()

                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO podcasts_items (podcast_id, track_id, guid, title, desc, keywords, author, media_url, image_url, publish_date, filename, downloaded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0)
                """, (podcastId, _time * 1000, entry.guid, entry.title, entry.description, tags, author, media_url, image, _time))

                console.print("[green]Founded:[/green] Podcast '{podcast}' have a new episode '{episode}'.".format(
                    episode=entry.title, podcast=podcast_title))

    try:
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        console.print("[red]Error:[/red] Can't fetch podcast entries from feed.")

    pass


def itemIsFetched(conn, guid: str):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(guid) as total FROM podcasts_items WHERE guid = '{guid}'".format(guid=guid))
    return False if int(cur.fetchone()[0]) == 0 else True


def downloadPodcastEpisodeImage(url):
    try:
        response = request.urlopen(url)
        imagedata = response.read()
    except:
        imagedata = None

    return imagedata


def dowloadAllPodcasts(conn):
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT id FROM podcasts WHERE suspended = 0
    """)

    for row in rows:
        downloadPodcasts(conn, str(row[0]))

    pass

def downloadPodcasts(conn, id):
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT podcasts.title as podcast_title, podcasts.artist, podcasts.image_url,
               podcasts_items.guid, podcasts_items.title, podcasts_items.media_url,
               podcasts_items.image_url, podcasts_items.publish_date, podcasts.id,
               podcasts_items.track_id
        FROM podcasts_items
            INNER JOIN podcasts ON podcasts.id = podcasts_items.podcast_id
        WHERE podcasts_items.downloaded = 0 AND podcasts.suspended = 0 AND podcasts.id = {id}
        ORDER BY podcasts_items.id DESC
    """.format(id=id))

    for row in rows:
        # map columns for readability (matches SELECT order above):
        # 0: podcasts.title
        # 1: podcasts.artist
        # 2: podcasts.image_url,
        # 3: podcasts_items.guid
        # 4: podcasts_items.title
        # 5: podcasts_items.media_url,
        # 6: podcasts_items.image_url
        # 7: podcasts_items.publish_date
        # 8: podcasts.id,
        # 9: podcasts_items.track_id
        podcast_title = str(row[0])
        podcast_artist = str(row[1])
        podcast_image_url = str(row[2])
        guid = str(row[3])
        title = str(row[4])
        media_url = str(row[5])
        episode_image_url = str(row[6])
        publish_ts = int(float(row[7]))
        podcast_id = int(row[8])
        track_id = int(row[9])

        createPoster(podcast_id, podcast_image_url)

        try:
            date = datetime.fromtimestamp(publish_ts).strftime("%Y-%m-%d")

            if not media_url:
                continue

            # Derive a filename: <podcastid>-<trackid>-<safe_title>.<ext>
            ext = Path(media_url.split("?")[0]).suffix or ".mp3"
            title_part = safe_filename(title or f"track-{track_id}")
            fname = f"pod{podcast_id}-trk{track_id}-{title_part}{ext}"
            dest = downloads_dir / fname

            if not dest.exists():
                with httpx.Client() as client:
                    download_one(client, media_url, dest)

                try:
                    audiofile = eyed3.load(dest)

                    if audiofile is not None:
                        audiofile.initTag()
                        audiofile.tag.clear()

                        audiofile.tag.artist = podcast_artist
                        audiofile.tag.album = podcast_title
                        audiofile.tag.title = title
                        audiofile.tag.release_date = date

                        episodeImage = downloadPodcastEpisodeImage(episode_image_url)
                        if episodeImage is not None:
                            audiofile.tag.images.set(3, episodeImage, "image/jpeg", u"cover")
                        audiofile.tag.save()

                    updateDownloadedState(conn, guid, fname)
                    console.print(f"[green]Success:[/green] {fname} file downloaded.")

                except:
                    pass

        except:
            pass

    pass


def updateDownloadedState(conn, guid: str, filename: str):
    cur = conn.cursor()
    cur.execute("""
        UPDATE podcasts_items SET filename = ?, downloaded = 1 WHERE guid = ?
    """, (filename, guid,))

    try:
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        console.print(f"[red]Error:[/red] Can't update podcast entry {guid} to downloaded state.")

    pass

def createPoster(podcast_id: int, image_url):
    base = Path(__file__).resolve().parent
    folderName = base / "downloads"

    # Validate image_url
    if not image_url:
        return

    path = urlsplit(image_url).path
    extension = os.path.splitext(path)[-1] or '.jpg'
    filename = os.path.join(folderName, f"pod{podcast_id}-poster{extension}")

    if not os.path.exists(filename):
        response = requests.get(image_url, stream=True)

        with response as r:
            if r.status_code == 200:
                r.raw.decode_content = True
                try:
                    with open(filename, 'wb') as f:
                        shutil.copyfileobj(r.raw, f)
                        console.print(f"[green]Success:[/green] {filename} file downloaded.")
                except:
                    pass

    pass


if __name__ == "__main__":
    arguments = docopt(__doc__, argv=None, help=True, version="1.0", options_first=False)

    configFolder = "/config" if is_docker() else os.getenv("CONFIG_PATH", "config")
    if not os.path.exists(configFolder):
        os.makedirs(configFolder)

    dbFilename = os.path.join(configFolder, "podpulse.db")
    firstTime = False if os.path.exists(dbFilename) else True
    conn = sqlite3.connect(dbFilename)

    base = Path(__file__).resolve().parent
    downloads_dir = base / "downloads"
    downloads_dir.mkdir(parents=True, exist_ok=True)

    if firstTime:
        createDatabase(conn)

    if arguments["search"]:
        regex = str(arguments["<regex>"])
        searchTunes(regex)

    if arguments["list"]:
        listPodcasts(conn)

    if arguments["add"]:
        _id = str(arguments["<iTunes>"])
        addPodcast(conn, _id)

    if arguments["import"]:
        rss = str(arguments["<rss>"])
        importRssFeed(conn, rss)

    if arguments["delete"]:
        _id = str(arguments["<id>"])
        deletePodcast(conn, _id)

    if arguments["fetch"]:
        _id = arguments["<id>"]
        if _id is None:
            fetchAllItems(conn)
        else:
            fetchPodcastItems(conn, str(_id))

    if arguments["download"]:
        dowloadAllPodcasts(conn)

    if arguments["podcast"]:
        _id = arguments["<id>"]
        if arguments["suspend"]:
            suspendPodcast(conn, str(_id), True)
        elif arguments["continue"]:
            suspendPodcast(conn, str(_id), False)
        elif arguments["download"]:
            downloadPodcasts(conn, str(id))

    conn.close()
