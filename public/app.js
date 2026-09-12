/**
 * GITARPLK entry point.
 *
 * Wires the three UI modules to one AlphaTabPlayer instance:
 *
 *   SongLibrary  --(song record)-->  AlphaTabPlayer  --(events)-->  TransportBar
 *                                                    --(events)-->  TrackMixer
 *
 * Loaded as an ES module, so AlphaTab's classic <script> tag in index.html has
 * already run by the time this executes and `window.alphaTab` exists.
 */

import { AlphaTabPlayer } from './js/alphatab-player.js';
import { TransportBar } from './js/ui-transport.js';
import { TrackMixer } from './js/ui-mixer.js';
import { SongLibrary } from './js/song-library.js';

document.addEventListener('DOMContentLoaded', () => {
  const renderElement = document.getElementById('alphatab-surface');
  const scrollElement = document.getElementById('tab-viewport');

  const player = new AlphaTabPlayer(renderElement, scrollElement).init();

  new TransportBar(player, document.getElementById('transport-bar'));
  new TrackMixer(
    player,
    document.getElementById('mixer-list'),
    document.getElementById('mixer-count')
  );

  const library = new SongLibrary({
    onSelect: (song) => {
      player.load(song).catch((error) => {
        console.error('Failed to load song', error);
        alert(`Could not load "${song.title}": ${error.message}`);
      });
    },
  });

  // Collapse/expand the mixer drawer.
  const mixerPanel = document.getElementById('mixer-panel');
  document.getElementById('btn-toggle-mixer').addEventListener('click', () => {
    mixerPanel.classList.toggle('collapsed');
  });

  library.load().catch((error) => {
    console.error('Failed to load song list', error);
  });
});
