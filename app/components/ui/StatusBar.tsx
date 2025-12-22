"use client";

import { useState, useEffect } from "react";

interface StatusBarProps {
  population: number;
  money: number;
}

export default function StatusBar({ population, money }: StatusBarProps) {
  const [date, setDate] = useState({ month: "Jan", year: 1 });
  const [time, setTime] = useState(0);

  // Simple time progression
  useEffect(() => {
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    const interval = setInterval(() => {
      setTime((prev) => {
        const newTime = prev + 1;
        const monthIndex = Math.floor(newTime / 10) % 12;
        const year = Math.floor(newTime / 120) + 1;
        setDate({ month: months[monthIndex], year });
        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="rct-frame"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 16px",
        height: 36,
      }}
    >
      {/* Money */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            color: "#2ecc40",
            fontSize: 14,
            fontWeight: "bold",
            fontFamily: "monospace",
            textShadow: "1px 1px 0 #000",
          }}
        >
          ${money.toLocaleString()}.00
        </span>
      </div>

      {/* Population */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>👥</span>
        <span
          style={{
            color: "var(--rct-text-light)",
            fontSize: 13,
            fontWeight: "bold",
            textShadow: "1px 1px 0 var(--rct-text-shadow)",
          }}
        >
          {population.toLocaleString()} Citizens
        </span>
      </div>

      {/* Game name */}
      <div
        style={{
          color: "var(--rct-panel-light)",
          fontSize: 11,
          opacity: 0.7,
        }}
      >
        Pogicity Tycoon
      </div>

      {/* Date */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            color: "var(--rct-text-light)",
            fontSize: 13,
            fontWeight: "bold",
            textShadow: "1px 1px 0 var(--rct-text-shadow)",
          }}
        >
          {date.month}, Year {date.year}
        </span>
        <span style={{ fontSize: 14 }}>🌤️</span>
        <span
          style={{
            color: "var(--rct-text-light)",
            fontSize: 12,
          }}
        >
          72°F
        </span>
      </div>
    </div>
  );
}









