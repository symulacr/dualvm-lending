import { useState } from "react";

export function InfoIcon({ tooltip }: { tooltip: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="info-icon-wrap" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="info-icon">i</span>
      {show && <span className="info-tooltip">{tooltip}</span>}
    </span>
  );
}
