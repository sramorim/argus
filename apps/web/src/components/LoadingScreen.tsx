"use client";

import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import gsap from "gsap";
import { Icon } from "./Icons";

const TYPEWRITER_TEXT = "INITIALIZING ARGOS INTELLIGENCE...";

interface LoadingScreenProps {
  onComplete: () => void;
}

export default function LoadingScreen({ onComplete }: LoadingScreenProps) {
  const [visible, setVisible] = useState(true);
  const [displayText, setDisplayText] = useState("");
  const [progress, setProgress] = useState(0);
  const [splitting, setSplitting] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const radarSvgRef = useRef<SVGSVGElement>(null);

  // Typewriter effect
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setDisplayText(TYPEWRITER_TEXT.slice(0, i + 1));
      i++;
      if (i >= TYPEWRITER_TEXT.length) clearInterval(interval);
    }, 45);
    return () => clearInterval(interval);
  }, []);

  // Progress animation
  useEffect(() => {
    const start = Date.now();
    const duration = 2500;
    const raf = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / duration) * 100, 100);
      setProgress(pct);
      if (pct < 100) requestAnimationFrame(raf);
      else {
        setTimeout(() => {
          setSplitting(true);
          setTimeout(() => {
            setVisible(false);
            onComplete();
          }, 700);
        }, 200);
      }
    };
    requestAnimationFrame(raf);
  }, [onComplete]);

  // GSAP counter for progress text
  const progressTextRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (progressTextRef.current) {
      gsap.fromTo(progressTextRef.current,
        { innerText: "0%" },
        { innerText: `${Math.round(progress)}%`, duration: 0.05, snap: { innerText: 1 }, ease: "none" }
      );
    }
  }, [progress]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      {!splitting ? (
        <motion.div
          key="loading"
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "#0a0a0f" }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Background grid */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />

          {/* Scanlines overlay */}
          <div
            className="absolute inset-0 pointer-events-none scanline-overlay"
            style={{ borderRadius: "inherit" }}
          />

          <div className="relative flex flex-col items-center gap-8 px-8 max-w-lg w-full">
            {/* Radar circle */}
            <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
              {/* Outer rings */}
              {[1, 0.66, 0.33].map((scale, i) => (
                <div
                  key={i}
                  className="absolute rounded-full border"
                  style={{
                    width: 140 * scale,
                    height: 140 * scale,
                    borderColor: `rgba(59,130,246,${0.15 + i * 0.05})`,
                  }}
                />
              ))}

              {/* Sweep */}
              <div
                className="absolute rounded-full animate-radar-sweep"
                style={{
                  width: 140,
                  height: 140,
                  background:
                    "conic-gradient(from 0deg, rgba(59,130,246,0) 60%, rgba(59,130,246,0.4) 100%)",
                }}
              />

              {/* Center dot */}
              <div
                className="absolute w-2.5 h-2.5 rounded-full"
                style={{ background: "#3b82f6", boxShadow: "0 0 12px #3b82f6" }}
              />

              {/* Blip dots */}
              {[
                { top: "20%", left: "68%" },
                { top: "58%", left: "30%" },
                { top: "40%", left: "75%" },
              ].map((pos, i) => (
                <div
                  key={i}
                  className="absolute w-1.5 h-1.5 rounded-full"
                  style={{
                    ...pos,
                    background: "#10b981",
                    boxShadow: "0 0 6px #10b981",
                    opacity: 0.8,
                  }}
                />
              ))}
            </div>

            {/* Title */}
            <div className="text-center">
              <p
                className="font-mono text-xs tracking-[0.3em] mb-3 uppercase"
                style={{ color: "rgba(59,130,246,0.6)" }}
              >
                MULTI-SOURCE INTELLIGENCE SYSTEM
              </p>
              <h1
                className="font-mono font-bold text-lg tracking-widest text-white"
                style={{
                  textShadow: "0 0 20px rgba(59,130,246,0.5)",
                  minHeight: "28px",
                }}
              >
                {displayText}
                <span
                  className="inline-block w-0.5 h-5 ml-0.5 align-bottom"
                  style={{
                    background: "#3b82f6",
                    animation: "blink-cursor 0.8s step-end infinite",
                  }}
                />
              </h1>
            </div>

            {/* Progress bar */}
            <div className="w-full">
              <div className="flex justify-between mb-1.5">
                <span className="font-mono text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                  LOADING INTEL SOURCES
                </span>
                <span ref={progressTextRef} className="font-mono text-xs" style={{ color: "#3b82f6" }}>
                  0%
                </span>
              </div>
              <div
                className="w-full h-1 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    width: `${progress}%`,
                    background: "linear-gradient(90deg, #1d4ed8, #3b82f6, #60a5fa)",
                    boxShadow: "0 0 12px rgba(59,130,246,0.6)",
                  }}
                  transition={{ ease: "linear", duration: 0.1 }}
                />
              </div>
            </div>

            {/* Status lines */}
            <div className="mt-4 space-y-1.5">
              {[
                { label: "Establishing secure connection...", done: progress > 20 },
                { label: "Loading intelligence feeds...", done: progress > 45 },
                { label: "Mapping active markers...", done: progress > 65 },
                { label: "Initializing OSINT/HUMINT/IMINT layers...", done: progress > 80 },
                { label: "System ready.", done: progress > 95 },
              ].map(({ label, done }, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-[10px]"
                  style={{ opacity: done ? 1 : 0.3, transition: "opacity 0.4s ease" }}>
                  <span style={{ color: done ? "#10b981" : "rgba(255,255,255,0.2)" }}>
                    {done ? "✓" : "○"}
                  </span>
                  <span style={{ color: done ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)" }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      ) : (
        /* Split reveal */
        <div className="fixed inset-0 z-[9999] pointer-events-none flex">
          <motion.div
            key="left"
            initial={{ x: 0 }}
            animate={{ x: "-100%" }}
            transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
            className="w-1/2 h-full"
            style={{ background: "#0a0a0f" }}
          />
          <motion.div
            key="right"
            initial={{ x: 0 }}
            animate={{ x: "100%" }}
            transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
            className="w-1/2 h-full"
            style={{ background: "#0a0a0f" }}
          />
        </div>
      )}
    </AnimatePresence>
  );
}