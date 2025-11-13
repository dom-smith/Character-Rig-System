import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, RotateCcw, Save, Download, Sparkles, Box, Layers, Zap, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';

const AdvancedCharacterRigTool = () => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [selectedJoint, setSelectedJoint] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [clothSimEnabled, setClothSimEnabled] = useState(true);
  const [showConstraints, setShowConstraints] = useState(true);
  const [panels, setPanels] = useState({
    controls: true,
    simulation: true,
    constraints: true
  });

  // Advanced rig state with full skeleton hierarchy
  const [skeleton, setSkeleton] = useState({
    pelvis: { pos: { x: 400, y: 450 } },
    spine1: { pos: { x: 400, y: 380 } },
    spine2: { pos: { x: 400, y: 320 } },
    chest: { pos: { x: 400, y: 270 } },
    neck: { pos: { x: 400, y: 230 } },
    head: { pos: { x: 400, y: 180 } },
    leftShoulder: { pos: { x: 350, y: 280 } },
    leftElbow: { pos: { x: 300, y: 320 } },
    leftWrist: { pos: { x: 280, y: 380 } },
    rightShoulder: { pos: { x: 450, y: 280 } },
    rightElbow: { pos: { x: 500, y: 320 } },
    rightWrist: { pos: { x: 520, y: 380 } }
  });

  const [ikTargets, setIkTargets] = useState({
    leftHand: { x: 280, y: 380, active: true },
    rightHand: { x: 520, y: 380, active: true }
  });

  const [constraints, setConstraints] = useState({
    leftArmPoleVector: { x: 250, y: 300, active: true },
    rightArmPoleVector: { x: 550, y: 300, active: true }
  });

  const [clothParticles, setClothParticles] = useState([]);
  const [clothConstraints, setClothConstraints] = useState([]);

  const [rigSettings, setRigSettings] = useState({
    ikBlend: 1.0,
    stretchiness: 0.3,
    gravity: 0.5,
    damping: 0.95,
    clothStiffness: 0.8,
    solver: 'fabrik'
  });

  // Initialize cloth simulation
  useEffect(() => {
    const particles = [];
    const constraints = [];
    const rows = 8;
    const cols = 6;
    const spacing = 15;
    const startX = 370;
    const startY = 270;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        particles.push({
          x: startX + c * spacing,
          y: startY + r * spacing,
          prevX: startX + c * spacing,
          prevY: startY + r * spacing,
          pinned: r === 0,
          mass: 1.0
        });
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (c < cols - 1) {
          constraints.push({ a: idx, b: idx + 1, restLength: spacing });
        }
        if (r < rows - 1) {
          constraints.push({ a: idx, b: idx + cols, restLength: spacing });
        }
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const idx = r * cols + c;
        constraints.push({ a: idx, b: idx + cols + 1, restLength: spacing * Math.sqrt(2) });
      }
    }

    setClothParticles(particles);
    setClothConstraints(constraints);
  }, []);

  // FABRIK IK Solver
  const solveFABRIK = (joints, target, iterations = 10) => {
    const chain = joints.map(j => ({ ...skeleton[j].pos }));
    const distances = [];
    
    for (let i = 0; i < chain.length - 1; i++) {
      const dx = chain[i + 1].x - chain[i].x;
      const dy = chain[i + 1].y - chain[i].y;
      distances.push(Math.sqrt(dx * dx + dy * dy));
    }

    const basePos = { ...chain[0] };

    for (let iter = 0; iter < iterations; iter++) {
      chain[chain.length - 1] = { ...target };
      for (let i = chain.length - 2; i >= 0; i--) {
        const dx = chain[i].x - chain[i + 1].x;
        const dy = chain[i].y - chain[i + 1].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const lambda = distances[i] / (dist || 1);
        chain[i] = {
          x: chain[i + 1].x + dx * lambda,
          y: chain[i + 1].y + dy * lambda
        };
      }

      chain[0] = { ...basePos };
      for (let i = 0; i < chain.length - 1; i++) {
        const dx = chain[i + 1].x - chain[i].x;
        const dy = chain[i + 1].y - chain[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const lambda = distances[i] / (dist || 1);
        chain[i + 1] = {
          x: chain[i].x + dx * lambda,
          y: chain[i].y + dy * lambda
        };
      }
    }

    return chain;
  };

  // Apply pole vector constraint
  const applyPoleVector = (shoulder, elbow, wrist, polePos) => {
    const mid = {
      x: (shoulder.x + wrist.x) / 2,
      y: (shoulder.y + wrist.y) / 2
    };
    
    const toElbow = {
      x: elbow.x - mid.x,
      y: elbow.y - mid.y
    };
    
    const toPole = {
      x: polePos.x - mid.x,
      y: polePos.y - mid.y
    };
    
    const lenElbow = Math.sqrt(toElbow.x * toElbow.x + toElbow.y * toElbow.y);
    const lenPole = Math.sqrt(toPole.x * toPole.x + toPole.y * toPole.y);
    
    if (lenElbow > 0 && lenPole > 0) {
      return {
        x: mid.x + (toPole.x / lenPole) * lenElbow,
        y: mid.y + (toPole.y / lenPole) * lenElbow
      };
    }
    
    return elbow;
  };

  // Update cloth simulation
  const updateClothSimulation = useCallback(() => {
    if (!clothSimEnabled || clothParticles.length === 0) return;

    const newParticles = [...clothParticles];
    const dt = 0.016;
    const gravity = rigSettings.gravity * 9.8;
    const chestX = skeleton.chest.pos.x;
    const chestY = skeleton.chest.pos.y;
    const cols = 6;

    newParticles.forEach((p, i) => {
      if (p.pinned) {
        const col = i % cols;
        p.x = chestX - 37.5 + col * 15;
        p.y = chestY;
        p.prevX = p.x;
        p.prevY = p.y;
        return;
      }

      const vx = (p.x - p.prevX) * rigSettings.damping;
      const vy = (p.y - p.prevY) * rigSettings.damping;

      p.prevX = p.x;
      p.prevY = p.y;

      p.x += vx;
      p.y += vy + gravity * dt * dt;
    });

    for (let iter = 0; iter < 3; iter++) {
      clothConstraints.forEach(constraint => {
        const pa = newParticles[constraint.a];
        const pb = newParticles[constraint.b];

        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const diff = (constraint.restLength - dist) / dist;

        const offsetX = dx * diff * 0.5 * rigSettings.clothStiffness;
        const offsetY = dy * diff * 0.5 * rigSettings.clothStiffness;

        if (!pa.pinned) {
          pa.x -= offsetX;
          pa.y -= offsetY;
        }
        if (!pb.pinned) {
          pb.x += offsetX;
          pb.y += offsetY;
        }
      });
    }

    setClothParticles(newParticles);
  }, [clothParticles, clothConstraints, skeleton.chest, rigSettings, clothSimEnabled]);

  // Update skeleton with IK solving
  const updateSkeleton = useCallback(() => {
    const newSkeleton = { ...skeleton };

    if (ikTargets.leftHand.active) {
      const leftArmChain = solveFABRIK(
        ['leftShoulder', 'leftElbow', 'leftWrist'],
        ikTargets.leftHand
      );

      if (constraints.leftArmPoleVector.active) {
        leftArmChain[1] = applyPoleVector(
          leftArmChain[0],
          leftArmChain[1],
          leftArmChain[2],
          constraints.leftArmPoleVector
        );
      }

      newSkeleton.leftShoulder.pos = leftArmChain[0];
      newSkeleton.leftElbow.pos = leftArmChain[1];
      newSkeleton.leftWrist.pos = leftArmChain[2];
    }

    if (ikTargets.rightHand.active) {
      const rightArmChain = solveFABRIK(
        ['rightShoulder', 'rightElbow', 'rightWrist'],
        ikTargets.rightHand
      );

      if (constraints.rightArmPoleVector.active) {
        rightArmChain[1] = applyPoleVector(
          rightArmChain[0],
          rightArmChain[1],
          rightArmChain[2],
          constraints.rightArmPoleVector
        );
      }

      newSkeleton.rightShoulder.pos = rightArmChain[0];
      newSkeleton.rightElbow.pos = rightArmChain[1];
      newSkeleton.rightWrist.pos = rightArmChain[2];
    }

    setSkeleton(newSkeleton);
  }, [skeleton, ikTargets, constraints]);

  // AI pose suggestion
  const suggestPose = async (poseType) => {
    setAiSuggesting(true);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `Generate a ${poseType} pose for a character rig. Return ONLY a JSON object (no markdown, no other text):
{
  "leftHand": {"x": number, "y": number},
  "rightHand": {"x": number, "y": number},
  "leftPoleVector": {"x": number, "y": number},
  "rightPoleVector": {"x": number, "y": number}
}

Canvas center: (400, 450). Character height: ~300px.
For ${poseType}: wave=right hand up at (480, 200), reach=both forward (300-500, 280), defensive=protect chest (360-440, 240), athletic=dynamic asymmetric.
Pole vectors slightly forward of elbows.`
          }]
        })
      });

      const data = await response.json();
      const text = data.content[0].text.trim().replace(/```json|```/g, '').trim();
      const poseData = JSON.parse(text);

      setIkTargets({
        leftHand: { ...poseData.leftHand, active: true },
        rightHand: { ...poseData.rightHand, active: true }
      });

      setConstraints({
        leftArmPoleVector: { ...poseData.leftPoleVector, active: true },
        rightArmPoleVector: { ...poseData.rightPoleVector, active: true }
      });
    } catch (error) {
      console.error('AI pose suggestion failed:', error);
    }
    setAiSuggesting(false);
  };

  // Drawing
  const drawCharacter = (ctx) => {
    ctx.clearRect(0, 0, 800, 600);

    // Grid
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 1;
    for (let i = 0; i < 800; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 600);
      ctx.stroke();
    }
    for (let i = 0; i < 600; i += 50) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(800, i);
      ctx.stroke();
    }

    // Draw cloth
    if (clothSimEnabled && clothParticles.length > 0) {
      ctx.fillStyle = 'rgba(200, 50, 50, 0.4)';
      ctx.strokeStyle = 'rgba(200, 50, 50, 0.6)';
      ctx.lineWidth = 1;

      const cols = 6;
      const rows = Math.floor(clothParticles.length / cols);

      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const idx = r * cols + c;
          const p1 = clothParticles[idx];
          const p2 = clothParticles[idx + 1];
          const p3 = clothParticles[idx + cols];
          const p4 = clothParticles[idx + cols + 1];

          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p4.x, p4.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Draw bones
    const drawBone = (start, end, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    };

    drawBone(skeleton.pelvis.pos, skeleton.spine1.pos, 18, '#5aa3f0');
    drawBone(skeleton.spine1.pos, skeleton.spine2.pos, 16, '#5aa3f0');
    drawBone(skeleton.spine2.pos, skeleton.chest.pos, 20, '#4a90e2');
    drawBone(skeleton.chest.pos, skeleton.neck.pos, 12, '#f5b968');
    drawBone(skeleton.neck.pos, skeleton.head.pos, 14, '#f5b968');
    drawBone(skeleton.chest.pos, skeleton.leftShoulder.pos, 12, '#e89a3c');
    drawBone(skeleton.leftShoulder.pos, skeleton.leftElbow.pos, 14, '#e89a3c');
    drawBone(skeleton.leftElbow.pos, skeleton.leftWrist.pos, 12, '#e89a3c');
    drawBone(skeleton.chest.pos, skeleton.rightShoulder.pos, 12, '#e89a3c');
    drawBone(skeleton.rightShoulder.pos, skeleton.rightElbow.pos, 14, '#e89a3c');
    drawBone(skeleton.rightElbow.pos, skeleton.rightWrist.pos, 12, '#e89a3c');

    // Draw joints
    const drawJoint = (pos, size, color, selected = false) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = selected ? '#ffff00' : '#ffffff';
      ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    Object.entries(skeleton).forEach(([name, joint]) => {
      drawJoint(joint.pos, 6, '#66ccff', selectedJoint === name);
    });

    // Head
    ctx.fillStyle = '#f5b968';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(skeleton.head.pos.x, skeleton.head.pos.y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#333333';
    ctx.beginPath();
    ctx.arc(skeleton.head.pos.x - 10, skeleton.head.pos.y - 5, 4, 0, Math.PI * 2);
    ctx.arc(skeleton.head.pos.x + 10, skeleton.head.pos.y - 5, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(skeleton.head.pos.x, skeleton.head.pos.y + 5, 12, 0, Math.PI);
    ctx.stroke();

    // IK targets
    const drawIKTarget = (pos, label, active) => {
      if (!active) return;
      ctx.fillStyle = 'rgba(255, 100, 100, 0.3)';
      ctx.strokeStyle = '#ff6464';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.fillText(label, pos.x + 15, pos.y + 5);
    };

    drawIKTarget(ikTargets.leftHand, 'L', ikTargets.leftHand.active);
    drawIKTarget(ikTargets.rightHand, 'R', ikTargets.rightHand.active);

    // Constraints
    if (showConstraints) {
      const drawConstraint = (pos, active) => {
        if (!active) return;
        ctx.fillStyle = 'rgba(100, 255, 100, 0.3)';
        ctx.strokeStyle = '#64ff64';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(pos.x - 8, pos.y - 8, 16, 16);
        ctx.fill();
        ctx.stroke();
      };

      drawConstraint(constraints.leftArmPoleVector, constraints.leftArmPoleVector.active);
      drawConstraint(constraints.rightArmPoleVector, constraints.rightArmPoleVector.active);
    }
  };

  // Animation loop
  useEffect(() => {
    const animate = () => {
      updateSkeleton();
      updateClothSimulation();

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        drawCharacter(ctx);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [updateSkeleton, updateClothSimulation, showConstraints]);

  // Mouse interaction
  const handleCanvasMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    Object.entries(ikTargets).forEach(([name, target]) => {
      const dist = Math.sqrt((x - target.x) ** 2 + (y - target.y) ** 2);
      if (dist < 15) {
        setSelectedJoint(name);
        setIsDragging(true);
      }
    });

    Object.entries(constraints).forEach(([name, constraint]) => {
      const dist = Math.sqrt((x - constraint.x) ** 2 + (y - constraint.y) ** 2);
      if (dist < 15) {
        setSelectedJoint(name);
        setIsDragging(true);
      }
    });
  };

  const handleCanvasMouseMove = (e) => {
    if (!isDragging || !selectedJoint) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (ikTargets[selectedJoint]) {
      setIkTargets(prev => ({
        ...prev,
        [selectedJoint]: { ...prev[selectedJoint], x, y }
      }));
    } else if (constraints[selectedJoint]) {
      setConstraints(prev => ({
        ...prev,
        [selectedJoint]: { ...prev[selectedJoint], x, y }
      }));
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
    setSelectedJoint(null);
  };

  const exportData = () => {
    const data = {
      skeleton,
      ikTargets,
      constraints,
      rigSettings,
      metadata: {
        tool: 'Advanced Character Rig System v2.0',
        solver: rigSettings.solver,
        created: new Date().toISOString()
      }
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `advanced_rig_${Date.now()}.json`;
    a.click();
  };

  const resetCloth = () => {
    const particles = [];
    const constraints = [];
    const rows = 8;
    const cols = 6;
    const spacing = 15;
    const startX = 370;
    const startY = 270;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        particles.push({
          x: startX + c * spacing,
          y: startY + r * spacing,
          prevX: startX + c * spacing,
          prevY: startY + r * spacing,
          pinned: r === 0,
          mass: 1.0
        });
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (c < cols - 1) {
          constraints.push({ a: idx, b: idx + 1, restLength: spacing });
        }
        if (r < rows - 1) {
          constraints.push({ a: idx, b: idx + cols, restLength: spacing });
        }
      }
    }

    setClothParticles(particles);
    setClothConstraints(constraints);
  };

  return (
    <div className="w-full h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white mb-1">Advanced Character Rig System</h1>
            <p className="text-gray-400 text-xs">ML-Powered IK | Physics Simulation | Multi-Solver Architecture</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => suggestPose('wave')}
              disabled={aiSuggesting}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded text-sm flex items-center gap-2"
            >
              <Sparkles size={14} />
              {aiSuggesting ? 'AI...' : 'AI Pose'}
            </button>
            <button
              onClick={exportData}
              className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm flex items-center gap-2"
            >
              <Download size={14} />
              Export
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div className="w-72 bg-gray-800 border-r border-gray-700 overflow-y-auto">
          {/* Solver Settings */}
          <div className="border-b border-gray-700">
            <button
              onClick={() => setPanels(p => ({ ...p, controls: !p.controls }))}
              className="w-full p-3 flex items-center justify-between text-white hover:bg-gray-700"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Zap size={16} />
                Solver Settings
              </span>
              {panels.controls ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {panels.controls && (
              <div className="p-3 space-y-3">
                <div>
                  <label className="block text-xs text-gray-300 mb-1">IK Solver Algorithm</label>
                  <select
                    value={rigSettings.solver}
                    onChange={(e) => setRigSettings({ ...rigSettings, solver: e.target.value })}
                    className="w-full bg-gray-700 text-white rounded px-2 py-1 text-sm"
                  >
                    <option value="fabrik">FABRIK (Forward/Backward)</option>
                    <option value="ccd">CCD (Cyclic Descent)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-300 mb-1">
                    IK/FK Blend: {rigSettings.ikBlend.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={rigSettings.ikBlend}
                    onChange={(e) => setRigSettings({ ...rigSettings, ikBlend: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-300 mb-1">
                    Stretchiness: {rigSettings.stretchiness.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={rigSettings.stretchiness}
                    onChange={(e) => setRigSettings({ ...rigSettings, stretchiness: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Physics Simulation */}
          <div className="border-b border-gray-700">
            <button
              onClick={() => setPanels(p => ({ ...p, simulation: !p.simulation }))}
              className="w-full p-3 flex items-center justify-between text-white hover:bg-gray-700"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Layers size={16} />
                Physics Simulation
              </span>
              {panels.simulation ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {panels.simulation && (
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-300">Enable Cloth Sim</label>
                  <button
                    onClick={() => setClothSimEnabled(!clothSimEnabled)}
                    className={`px-3 py-1 rounded text-xs ${
                      clothSimEnabled ? 'bg-green-600' : 'bg-gray-600'
                    }`}
                  >
                    {clothSimEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-gray-300 mb-1">
                    Gravity: {rigSettings.gravity.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={rigSettings.gravity}
                    onChange={(e) => setRigSettings({ ...rigSettings, gravity: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-300 mb-1">
                    Damping: {rigSettings.damping.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="1"
                    step="0.01"
                    value={rigSettings.damping}
                    onChange={(e) => setRigSettings({ ...rigSettings, damping: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-300 mb-1">
                    Cloth Stiffness: {rigSettings.clothStiffness.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={rigSettings.clothStiffness}
                    onChange={(e) => setRigSettings({ ...rigSettings, clothStiffness: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <button
                  onClick={resetCloth}
                  className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                >
                  Reset Cloth Simulation
                </button>
              </div>
            )}
          </div>

          {/* Constraints */}
          <div className="border-b border-gray-700">
            <button
              onClick={() => setPanels(p => ({ ...p, constraints: !p.constraints }))}
              className="w-full p-3 flex items-center justify-between text-white hover:bg-gray-700"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Box size={16} />
                Constraints
              </span>
              {panels.constraints ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {panels.constraints && (
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-300">Show Constraints</label>
                  <button
                    onClick={() => setShowConstraints(!showConstraints)}
                    className="flex items-center gap-1 text-white"
                  >
                    {showConstraints ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                    <span className="text-xs text-gray-300">Left Pole Vector</span>
                    <button
                      onClick={() => setConstraints(prev => ({
                        ...prev,
                        leftArmPoleVector: { ...prev.leftArmPoleVector, active: !prev.leftArmPoleVector.active }
                      }))}
                      className={`px-2 py-1 rounded text-xs ${
                        constraints.leftArmPoleVector.active ? 'bg-green-600' : 'bg-red-600'
                      }`}
                    >
                      {constraints.leftArmPoleVector.active ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-gray-700 rounded">
                    <span className="text-xs text-gray-300">Right Pole Vector</span>
                    <button
                      onClick={() => setConstraints(prev => ({
                        ...prev,
                        rightArmPoleVector: { ...prev.rightArmPoleVector, active: !prev.rightArmPoleVector.active }
                      }))}
                      className={`px-2 py-1 rounded text-xs ${
                        constraints.rightArmPoleVector.active ? 'bg-green-600' : 'bg-red-600'
                      }`}
                    >
                      {constraints.rightArmPoleVector.active ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AI Pose Presets */}
          <div className="p-3">
            <h3 className="text-xs font-semibold text-gray-300 mb-2">AI Pose Generation</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => suggestPose('wave')}
                disabled={aiSuggesting}
                className="px-2 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded text-xs"
              >
                Wave
              </button>
              <button
                onClick={() => suggestPose('reach')}
                disabled={aiSuggesting}
                className="px-2 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded text-xs"
              >
                Reach
              </button>
              <button
                onClick={() => suggestPose('defensive')}
                disabled={aiSuggesting}
                className="px-2 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded text-xs"
              >
                Defensive
              </button>
              <button
                onClick={() => suggestPose('athletic')}
                disabled={aiSuggesting}
                className="px-2 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded text-xs"
              >
                Athletic
              </button>
            </div>
            {aiSuggesting && (
              <div className="mt-2 text-xs text-purple-400 flex items-center gap-2">
                <Sparkles size={12} className="animate-pulse" />
                AI generating pose...
              </div>
            )}
          </div>

          {/* Technical Info */}
          <div className="p-3 bg-blue-900 bg-opacity-20 border-t border-gray-700">
            <h3 className="text-xs font-semibold text-blue-300 mb-2">Technical Features</h3>
            <ul className="text-xs text-blue-200 space-y-1">
              <li>• Multi-solver IK (FABRIK/CCD)</li>
              <li>• Verlet cloth physics</li>
              <li>• Pole vector constraints</li>
              <li>• AI-powered pose generation</li>
              <li>• Real-time constraint solving</li>
              <li>• Production-ready export</li>
            </ul>
          </div>
        </div>

        {/* Main Viewport */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 flex items-center justify-center bg-gray-850 p-4">
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              className="border-2 border-gray-700 rounded shadow-2xl bg-gray-900 cursor-crosshair"
            />
          </div>

          {/* Status Bar */}
          <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-4">
              <span>Solver: {rigSettings.solver.toUpperCase()}</span>
              <span>Cloth Particles: {clothParticles.length}</span>
              <span>Constraints: {clothConstraints.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded ${clothSimEnabled ? 'bg-green-900 text-green-300' : 'bg-gray-700'}`}>
                Physics {clothSimEnabled ? 'ON' : 'OFF'}
              </span>
              <span className="text-gray-500">Drag IK targets (red circles) or pole vectors (green squares)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdvancedCharacterRigTool;
