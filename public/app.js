/**
 * GITARPLK entry point.
 *
 * Wires the UI modules to one AlphaTabPlayer instance:
 *
 *   SongLibrary       --(song record)-->  AlphaTabPlayer  --(events)-->  TransportBar
 *                                                         --(events)-->  TrackMixer
 *   AddSongDashboard  --(POST /api/songs)-->  SongLibrary.load()
 *
 * Loaded as an ES module, so AlphaTab's classic <script> tag in index.html has
 * already run by the time this executes and `window.alphaTab` exists.
 */

import { AlphaTabPlayer } from './js/alphatab-player.js';
import { TransportBar } from './js/ui-transport.js';
import { TrackMixer } from './js/ui-mixer.js';
import { SongLibrary } from './js/song-library.js';
import { AddSongDashboard } from './js/ui-add-song.js';

document.addEventListener('DOMContentLoaded', async () => {
  const renderElement = document.getElementById('alphatab-surface');
  const scrollElement = document.getElementById('tab-viewport');

  const player = new AlphaTabPlayer(renderElement, scrollElement).init();

  new TransportBar(player, document.getElementById('transport-bar'));
  new TrackMixer(
    player,
    document.getElementById('mixer-list'),
    document.getElementById('mixer-count'),
    document.getElementById('mixer-notice')
  );

  // Song directory drawer: an off-canvas panel on mobile (see the
  // max-width: 900px breakpoint in style.css), a permanent column above it.
  const sidebar = document.querySelector('.sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');
  const closeSidebar = () => {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('visible');
    toggleSidebarBtn.setAttribute('aria-expanded', 'false');
  };
  toggleSidebarBtn.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    sidebarBackdrop.classList.toggle('visible', open);
    toggleSidebarBtn.setAttribute('aria-expanded', String(open));
  });
  sidebarBackdrop.addEventListener('click', closeSidebar);
  // Close on any song pick, even a rig-only entry with no score (which never
  // fires onSelect below) — the drawer's job is done once a choice is made.
  document.getElementById('song-list').addEventListener('click', (event) => {
    if (event.target.closest('li')) closeSidebar();
  });

  const library = new SongLibrary({
    onSelect: (song) => {
      player.load(song).catch((error) => {
        console.error('Failed to load song', error);
        alert(`Could not load "${song.title}": ${error.message}`);
      });
    },
  });

  const addSong = await new AddSongDashboard({
    onSaved: () => library.load(),
    getArtists: () => library.artists(),
  }).init();

  // "Upload a tab for this song" on a rig-only entry opens the form with the
  // artist and title already filled in.
  document.getElementById('btn-attach-score').addEventListener('click', () => {
    const song = library.currentSong;
    addSong.open(song ? { artist: song.artist, title: song.title } : {});
  });

  // Collapse/expand the mixer drawer. On mobile it overlays the workspace
  // (see the max-width: 900px breakpoint in style.css), so start collapsed
  // there instead of covering the screen on load; on desktop it stays open
  // as a permanent column, matching prior behavior.
  const mixerPanel = document.getElementById('mixer-panel');
  if (window.matchMedia('(max-width: 900px)').matches) {
    mixerPanel.classList.add('collapsed');
  }
  document.getElementById('btn-toggle-mixer').addEventListener('click', () => {
    mixerPanel.classList.toggle('collapsed');
  });

  library.load().catch((error) => {
    console.error('Failed to load song list', error);
  });
});
