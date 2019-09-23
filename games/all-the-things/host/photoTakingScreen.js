"use strict";

async function photoTakingScreen(thing) {
  await waitForNSeconds(1);

  const piggy = document.createElement('img');
  piggy.classList.add('piggy');
  piggy.src = '/games/all-the-things/images/piggy_on_scooter.svg';
  document.body.appendChild(piggy);
  await waitForNSeconds(4);
  piggy.remove();

  for (const player of players) {
    player.classList.add('moving-to-grid');
  }

  const playerGrid = startPlayerGrid();
  await waitForNSeconds(2.5);

  for (const player of players) {
    player.classList.add('scale-down');
  }
  await waitForNSeconds(0.5);

  const shutterSound        = new Audio('/games/all-the-things/sounds/camera-shutter.ogg');
  const allPhotosTakenSound = new Audio('/games/all-the-things/sounds/all-photos-taken.mp3');

  document.body.insertAdjacentHTML('beforeend', `
    <div class="all-the-things photo-taking-screen">
      <h1>Take your photos!</h1>
    </div>
  `);
  const photoTakingScreen = document.body.lastElementChild;

  // Wait for every player to take a photo
  const playersWithPhotos = new Set();
  const photoChannels = new Set();
  const timers = [];
  await new Promise(resolve => {
    function checkIfAllPhotosTaken() {
      if (players.length > 0 && players.every(p => playersWithPhotos.has(p))) {
        resolve();
        stopAcceptingPlayers();
        stopListeningForLeavingPlayer(checkIfAllPhotosTaken);
      }
    }
    acceptAllPlayers(player => {
      player.insertAdjacentHTML('beforeend', `
        <div class="all-the-things phone">
          <div class="phone-background"></div>
          <div class="phone-switched-off-black"></div>
          <div class="phone-foreground"></div>
        </div>
      `);
      player.classList.remove('bubble');
      player.classList.add('taking-photo');
      player.classList.add('moving-to-grid');
      player.classList.remove('scale-down');
      timers.push(setTimeout(() => player.classList.add('video-not-visible'), 15000));
      if (!player.parentElement) {
        playerGrid.updateLayout();
        document.body.appendChild(player);
      }
      const photoChannel = player.rtcConnection.createDataChannel('all-the-things_photo');
      photoChannel.onopen = () => {
        photoChannel.send(thing);
      }
      photoChannels.add(photoChannel);
      photoChannel.onmessage = async function(event) {
        shutterSound.play();
        const arrayBuffer = event.data;
        const blob = new Blob([arrayBuffer], {type: 'image/jpeg'});
        const image = new Image();
        image.src = URL.createObjectURL(blob);
        const photoContainer = document.createElement('div');
        photoContainer.classList.add('all-the-things');
        photoContainer.classList.add('photo-container');
        photoContainer.player = player;
        photoContainer.arrayBuffer = arrayBuffer;
        const cropContainer = document.createElement('div');
        cropContainer.classList.add('crop-container');
        cropContainer.appendChild(image);
        player.classList.add('photo-taken');
        photoContainer.appendChild(cropContainer);
        document.body.appendChild(photoContainer);
        player.photo = photoContainer;
        playersWithPhotos.add(player);
        playerGrid.updateLayout();
        player.classList.add('camera-shutter');
        setTimeout(() => player.classList.remove('camera-shutter'), 200);
        setTimeout(() => {
          player.remove();
          player.classList.remove('moving-to-grid');
          player.classList.remove('taking-photo');
          player.classList.remove('photo-taken');
          player.style.width  = '';
          player.style.height = '';
          player.querySelector('.phone').remove();
        }, 1000);
        checkIfAllPhotosTaken();
      }
    });
    listenForLeavingPlayer(player => {
      if (player.photo) {
        player.photo.remove();
      }
      checkIfAllPhotosTaken();
    });
  });
  photoTakingScreen.querySelector('h1').textContent = 'All photos taken';
  allPhotosTakenSound.play();
  document.body.classList.add('all-the-things_all-photos-taken');
  await waitForNSeconds(0.5);
  document.body.classList.remove('all-the-things_all-photos-taken');

  await waitForNSeconds(2);

  // Highlight all photos
  const highlightDurationSecs = 0.4;
  for (const [index, player] of players.entries()) {
    player.photo.style.animationDelay = (highlightDurationSecs * (index / (players.length-1))) + 's';
    player.photo.classList.add('all-photos-taken-highlight');
  }
  await waitForNSeconds(1);
  for (const player of players) {
    player.photo.style.animationDelay = '';
  }

  for (const channel of photoChannels) {
    channel.close();
  }
  photoTakingScreen.remove();

  for (const player of players) {
    player.classList.remove('video-not-visible');
  }
  for (const timerId of timers) {
    clearTimeout(timerId);
  }

  return playerGrid;
}