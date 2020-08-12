import routes from '/host/routes.mjs';

import * as audienceMode from '/host/audienceMode.mjs';
import * as messaging from '/host/messaging.mjs';

import {receiveLargeBlobOnChannel} from '/common/utils.mjs';

document.head.insertAdjacentHTML('beforeend', `
  <link rel="stylesheet" href="/apps/show-and-tell/host/app-index.css">
`);

routes['#apps/show-and-tell'] = async function showAndTell({waitForEnd, listenForPlayers, createChannel}) {
  document.body.style.backgroundColor = '#fff';

  const container = document.createElement('div');
  container.attachShadow({mode: 'open'}).innerHTML = `
    <link rel="stylesheet" href="/apps/show-and-tell/host/show-and-tell.css">
    <img>
    <iframe class="youtube-iframe" allow="autoplay">
  `;
  document.body.append(container);

  const image = container.shadowRoot.querySelector('img');
  const youtubeIframe = container.shadowRoot.querySelector('.youtube-iframe');

  audienceMode.start();
  messaging.start();

  listenForPlayers(async player => {
    const channel = createChannel(player, 'upload');
    while (channel.readyState !== 'closed') {
      const blob = await receiveLargeBlobOnChannel(channel);
      if (blob) {
        image.src = URL.createObjectURL(blob);
      }
    }
  });

  listenForPlayers(async player => {
    const channel = createChannel(player, 'youtube');
    channel.onmessage = ({data}) => {
      const message = JSON.parse(data);
      switch (message.command) {
        case 'load':  youtubeIframe.src = `https://www.youtube.com/embed/${message.videoId}?enablejsapi=1&autoplay=1`; break;
        case 'close': youtubeIframe.src = ''; break;
        case 'play':  youtubeIframe.contentWindow.postMessage('{"event":"command","func":"playVideo"}', '*'); break;
        case 'pause': youtubeIframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo"}', '*'); break;
      }
    }
    channel.onclose = () => {
      youtubeIframe.src = '';
    }
  });

  await waitForEnd();

  audienceMode.stop();
  messaging.stop();
  container.remove();
}
