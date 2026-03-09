const WORDMARK = {
  first: "Vocal",
  second: "Type",
};

const VocalTypeLogo = ({
  width,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) => {
  return (
    <div
      className={className}
      style={{
        fontFamily: "'Cabinet Grotesk', 'Geist Pixel Circle', monospace",
        fontSize: width ? width / 4.2 : 28,
        fontWeight: "900",
        letterSpacing: "-0.5px",
        width,
        display: "flex",
        alignItems: "center",
        gap: "2px",
      }}
    >
      <span style={{ color: "#f5f2ed" }}>{WORDMARK.first}</span>
      <span style={{ color: "#c9a84c" }}>{WORDMARK.second}</span>
    </div>
  );
};

export default VocalTypeLogo;
