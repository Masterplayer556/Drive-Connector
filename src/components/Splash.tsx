export default function Splash({ text }: { text?: string }) {
  return (
    <div className="splash">
      <div className="splash-logo">
        <img src="./icons/icon-192.png" alt="" />
      </div>
      <h1 className="grad-text">Drive Pool</h1>
      {text ? <p className="muted">{text}</p> : <div className="spinner" />}
    </div>
  );
}
