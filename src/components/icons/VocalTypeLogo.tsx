const WORDMARK = {
  first: "Vocal",
  second: "Type",
};

const VocalypeLogo = ({
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
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize: width ? width / 5.2 : 20,
        fontWeight: "600",
        letterSpacing: "-0.5px",
        width,
        display: "flex",
        alignItems: "center",
        gap: "0px",
        lineHeight: 1,
      }}
    >
      <span style={{ color: "#f5f2ed" }}>{WORDMARK.first}</span>
      <span style={{ color: "#c9a84c" }}>{WORDMARK.second}</span>
    </div>
  );
};

export default VocalypeLogo;
