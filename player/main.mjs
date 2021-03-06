setupServiceWorker();

import {
  waitForNSeconds,
  waitForPageToBeVisible,
  waitForWebsocketOpen
} from '/common/utils.mjs';

import {
  negotiateRtcConnection,
  waitForRtcClose,
  setupKeepaliveChannel
} from '/common/rtc.mjs';

import {startRouting} from './routes.mjs';

import './splash-screen.mjs';

import '/apps/tunnel-vision/player/tunnel-vision.mjs';
import '/apps/show-and-tell/player/show-and-tell.mjs';
import '/apps/bubbleland/player/bubbleland.mjs';
import '/apps/test/player/test.mjs';

location.hash = '';

setupMenu();

connectLoop();

async function connectLoop() {

  // Continuosly attempt to connect to a host, by first establishing a websocket to the server which
  // will then broker a WebRTC connection to a host. A host is another web browser running at /host instead of /player

  while (true) {
    await waitForPageToBeVisible();

    showStatus('waiting', 'Connecting..', 'Opening websocket');
    try {
      const websocketProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
      var websocket = new WebSocket(`${websocketProtocol}://${location.hostname}:${location.port}/player/ws`);
    } catch(error) {
      showStatus('error', 'websocket failed', `Unable to initialize: ${error}`);
      continue;
    }

    let hasHost = false;
    let waitingOnHostCallback = null;
    websocket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.host) {
        hasHost = message.host === 'connected';
        if (hasHost && waitingOnHostCallback) {
          waitingOnHostCallback('host-connected');
        }
      }
    });
    websocket.addEventListener('close', () => {
      hasHost = false;
      if (waitingOnHostCallback) {
        waitingOnHostCallback('websocket-closed');
      }
    });

    const connectResult = await new Promise(resolve => {
      const timerId = setTimeout(() => {
        resolve('timeout');
        websocket.close();
      }, 3000);
      websocket.addEventListener('open', 
        () => {
          clearTimeout(timerId);
          resolve('websocket-open');
        },
        {once: true}
      );
      websocket.addEventListener('close',
        event => {
          clearTimeout(timerId);
          resolve(event);
        },
        {once: true}
      );
    });

    if (connectResult !== 'websocket-open') {
      if (connectResult === 'timeout') {
        await showStatus('error', 'websocket failed', 'Timed-out waiting for websocket to connect');
      } else {
        await showStatus('error', 'websocket failed', `Code: ${connectResult.code}, reason: "${connectResult.reason}", was clean: ${connectResult.wasClean}`);
      }
      showStatus('waiting', 'Connecting..', 'Opening websocket');
      await waitForNSeconds(1);
      continue;
    }

    while (true) {
      await waitForPageToBeVisible();

      if (websocket.readyState !== websocket.OPEN) {
        break;
      }

      if (!hasHost) {
        showStatus('waiting', 'Waiting for host...');
        const waitForHostResult = await new Promise(resolve => waitingOnHostCallback = resolve);
        waitingOnHostCallback = null;
        if (waitForHostResult !== 'host-connected') {
          await showStatus('error', 'websocket failed', 'Websocket closed before a host could be found');
          break;
        }
      }

      await connectRtcAndStartRouting(websocket);
    }
  }
}

async function showStatus(status, description='', detail='') {
  document.getElementById('status-container').className = status;
  document.getElementById('status-description').textContent = description;
  document.getElementById('status-detail').textContent = detail;
  if (status === 'error') {
    await waitForNSeconds(2);
  }
}

function setupServiceWorker() {
  if (navigator.serviceWorker) {
    // A registered service worker is a browser requirement to allow the app to be installed as a PWA.
    navigator.serviceWorker.register('/common/service-worker.js', {scope: '/'})
    .catch(error => {
      // Ignore any error. It might be because the app is running from an insecure context, for development.
      // The app can run without a service worker.
    });
  }
}

function setupMenu() {
  const menu = document.getElementById('menu');
  menu.querySelector('.toggle').onclick = () => {
    menu.classList.toggle('visible');
  }

  menu.querySelector('.host').onclick = () => {
    location.pathname = 'host';
  }

  setupFullscreenButton();
  setupInstallButton();
  setupConnectionInfoButton();
}

function setupFullscreenButton() {
  // Only show the fullscreen button if the fullscreen API is available.
  // Note that Safari's fullscreen functions are prefixed with 'webkit'.
  if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) {
    return;
  }

  const clickSound = new Audio('/sounds/click.wav');

  function toggleFullscreen() {
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({navigationUI: "hide"});
      else if (document.documentElement.webkitRequestFullscreen) document.documentElement.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
    clickSound.play();
  }

  const fullscreenButton = document.querySelector('#menu .items .fullscreen');
  fullscreenButton.onclick = () => {
    toggleFullscreen();
    document.getElementById('menu').classList.remove('visible');
  }
  fullscreenButton.classList.remove('unimplemented');
}

function setupInstallButton() {
  let installButton = null;
  window.onbeforeinstallprompt = event => {
    event.preventDefault();
    if (!installButton) {
      installButton = document.createElement('push-button');
      installButton.textContent = 'Install';
      document.querySelector('#menu .items').append(installButton);
    }
    installButton.onclick = () => {
      event.prompt();
    }
    event.userChoice.then(result => {
      if (result.outcome === 'accepted') {
        installButton.remove();
      }
    });
  }
}

function setupConnectionInfoButton() {
  const connectionInfo = document.querySelector('#menu > .connection-info');
  const connectionInfoButton = document.querySelector('#menu .items .connection-info');
  connectionInfoButton.onclick = () => {
    connectionInfo.classList.toggle('visible');
  }
  connectionInfo.querySelector('.close-button').onclick = () => connectionInfo.classList.remove('visible');
}

async function connectRtcAndStartRouting(websocket) {
  showStatus('waiting', 'Establishing WebRTC connection', 'Setting up connection object');

  const rtcConnection = new RTCPeerConnection();

  const keepaliveChannel = rtcConnection.createDataChannel('keepalive', {negotiated: true, id: 7, ordered: false});
  const waitForKeepaliveEnd = setupKeepaliveChannel(keepaliveChannel);

  const visibilityChannel = rtcConnection.createDataChannel('visibility', {negotiated: true, id: 5, ordered: true});
  function handleVisibilityChange() { visibilityChannel.send(document.visibilityState); }
  visibilityChannel.onopen  = () => document.addEventListener(   'visibilitychange', handleVisibilityChange);
  visibilityChannel.onclose = () => document.removeEventListener('visibilitychange', handleVisibilityChange);

  const avatarChannel = rtcConnection.createDataChannel('avatar', {negotiated: true, id: 10, ordered: true});
  avatarChannel.onmessage = async ({data}) => {
    if (data === 'request') {
      if (!navigator.mediaDevices) {
        return;
      }
      try {
        var stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user'}, audio: false});
      } catch(error) {
        avatarChannel.send(JSON.stringify({error: error}));
        return;
      }
      const tracks = stream.getTracks();
      if (tracks.length === 1) {
        rtcConnection.addTrack(tracks[0], stream);
        // Track IDs are not preserved on the remote peer, but stream IDs are.
        // See https://stackoverflow.com/a/61928039
        avatarChannel.send(JSON.stringify({streamId: stream.id}));
      } else {
        alert(`Got ${tracks.length} tracks intead of 1 when getting avatar video`);
      }
    }
  }

  const routeChannel = rtcConnection.createDataChannel('route', {negotiated: true, id: 9, ordered: true});

  // Setup RTC signalling
  const signalling = {
    send: signal => websocket.send(JSON.stringify(signal)),
    onsignal: () => {},
    onclose: () => {},
  }
  websocket.addEventListener('message', ({data}) => {
    const signal = JSON.parse(data);
    signalling.onsignal(signal);
  });
  websocket.addEventListener('close', () => signalling.onclose());

  showStatus('waiting', 'Connecting', 'Negotiating WebRTC connection...');
  try {
    await negotiateRtcConnection(rtcConnection, signalling);
  } catch(error) {
    await showStatus('error', 'Failed to connect', error);
    return;
  }

  const waitForRouting = startRouting(rtcConnection, routeChannel);

  showStatus('');

  await Promise.race([waitForRtcClose(rtcConnection), waitForKeepaliveEnd]);
  rtcConnection.close();
  await waitForRouting;
  await showStatus('error', 'Host disconnected', 'reconnecting in 2 seconds..');
}
