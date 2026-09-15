/* WatchRoom Lite: low-bandwidth WebRTC screen sharing.
   The host shares a tab/window/screen; viewers receive it in a <video> element.
   A tiny ephemeral WebSocket room is used only for signaling. No media is stored. */
export function createScreenShare({ socket, roomId, userId, hostVideo, viewerVideo, onState = () => {} }) {
  let stream = null;
  const peers = new Map();
  const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const send = message => socket?.readyState === 1 && socket.send(JSON.stringify({ ...message, roomId, from: userId }));

  const makePeer = async (peerId, initiator) => {
    if (peers.has(peerId)) return peers.get(peerId);
    const pc = new RTCPeerConnection(rtcConfig);
    peers.set(peerId, pc);
    pc.onicecandidate = e => e.candidate && send({ type: 'screen-signal', to: peerId, data: { candidate: e.candidate } });
    pc.ontrack = e => {
      if (!viewerVideo.srcObject) viewerVideo.srcObject = e.streams[0];
      viewerVideo.play().catch(() => {});
      onState('watching');
    };
    if (stream) stream.getTracks().forEach(track => pc.addTrack(track, stream));
    if (initiator) {
      const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      send({ type: 'screen-signal', to: peerId, data: { sdp: pc.localDescription } });
    }
    return pc;
  };

  async function start() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      onState('unsupported');
      throw new Error('This browser does not provide screen sharing. Use Chrome/Edge on PC or Android.');
    }
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 854, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 12, max: 15 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    hostVideo.srcObject = stream;
    hostVideo.muted = true;
    hostVideo.play().catch(() => {});
    const video = stream.getVideoTracks()[0];
    await video.applyConstraints({ frameRate: { max: 15 } }).catch(() => {});
    video.onended = stop;
    send({ type: 'screen-started' });
    onState('sharing');
  }

  function stop() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    peers.forEach(pc => pc.close());
    peers.clear();
    hostVideo.srcObject = null;
    viewerVideo.srcObject = null;
    send({ type: 'screen-stopped' });
    onState('stopped');
  }

  async function handle(message) {
    if (message.type === 'screen-viewer-joined' && stream) await makePeer(message.from, true);
    if (message.type === 'screen-signal') {
      const pc = await makePeer(message.from, false);
      if (message.data?.sdp) {
        await pc.setRemoteDescription(message.data.sdp);
        if (message.data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: 'screen-signal', to: message.from, data: { sdp: pc.localDescription } });
        }
      }
      if (message.data?.candidate) await pc.addIceCandidate(message.data.candidate).catch(() => {});
    }
    if (message.type === 'screen-started') {
      send({ type: 'screen-viewer-joined', to: message.from });
      onState('connecting');
    }
    if (message.type === 'screen-stopped') { viewerVideo.srcObject = null; onState('stopped'); }
  }

  socket?.addEventListener('message', event => { try { handle(JSON.parse(event.data)); } catch {} });
  return { start, stop, handle, isSharing: () => Boolean(stream) };
}