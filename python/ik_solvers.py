"""
Advanced IK Solvers for Character Rigging
Implements FABRIK and CCD algorithms with performance optimizations
"""

import numpy as np
from typing import List, Tuple, Optional
import time


class Joint:
    """Represents a joint in a kinematic chain"""
    def __init__(self, position: np.ndarray, name: str = ""):
        self.position = np.ndarray(position, dtype=np.float32)
        self.name = name
        
    def distance_to(self, other: 'Joint') -> float:
        """Calculate distance to another joint"""
        return np.linalg.norm(self.position - other.position)


class IKChain:
    """Represents a kinematic chain for IK solving"""
    def __init__(self, joints: List[Joint]):
        self.joints = joints
        self.bone_lengths = self._calculate_bone_lengths()
        self.total_length = sum(self.bone_lengths)
        
    def _calculate_bone_lengths(self) -> List[float]:
        """Pre-calculate bone lengths for efficiency"""
        lengths = []
        for i in range(len(self.joints) - 1):
            lengths.append(self.joints[i].distance_to(self.joints[i + 1]))
        return lengths
    
    def is_reachable(self, target: np.ndarray) -> bool:
        """Check if target is within reach of the chain"""
        distance = np.linalg.norm(target - self.joints[0].position)
        return distance <= self.total_length


class FABRIKSolver:
    """
    FABRIK (Forward And Backward Reaching Inverse Kinematics) Solver
    
    Reference: Aristidou, A., & Lasenby, J. (2011). 
    "FABRIK: A fast, iterative solver for the Inverse Kinematics problem"
    
    Time Complexity: O(n * iterations) where n is number of joints
    Space Complexity: O(n)
    """
    
    def __init__(self, tolerance: float = 0.01, max_iterations: int = 10):
        self.tolerance = tolerance
        self.max_iterations = max_iterations
        self.solve_time = 0.0
        
    def solve(self, chain: IKChain, target: np.ndarray, 
              constraints: Optional[dict] = None) -> IKChain:
        """
        Solve IK using FABRIK algorithm
        
        Args:
            chain: The kinematic chain to solve
            target: Target position for end effector
            constraints: Optional joint constraints (angle limits, etc.)
            
        Returns:
            Solved IKChain with updated joint positions
        """
        start_time = time.perf_counter()
        
        # Check if target is reachable
        if not chain.is_reachable(target):
            # Target out of reach - stretch towards it
            direction = (target - chain.joints[0].position)
            direction = direction / np.linalg.norm(direction)
            chain.joints[-1].position = (chain.joints[0].position + 
                                         direction * chain.total_length)
        
        base_position = chain.joints[0].position.copy()
        
        for iteration in range(self.max_iterations):
            # Forward reaching phase
            chain.joints[-1].position = target.copy()
            
            for i in range(len(chain.joints) - 2, -1, -1):
                # Calculate direction from joint i+1 to joint i
                direction = chain.joints[i].position - chain.joints[i + 1].position
                distance = np.linalg.norm(direction)
                
                if distance > 1e-6:  # Avoid division by zero
                    direction = direction / distance
                    # Place joint i at correct distance from joint i+1
                    chain.joints[i].position = (chain.joints[i + 1].position + 
                                               direction * chain.bone_lengths[i])
            
            # Backward reaching phase
            chain.joints[0].position = base_position.copy()
            
            for i in range(len(chain.joints) - 1):
                # Calculate direction from joint i to joint i+1
                direction = chain.joints[i + 1].position - chain.joints[i].position
                distance = np.linalg.norm(direction)
                
                if distance > 1e-6:
                    direction = direction / distance
                    # Place joint i+1 at correct distance from joint i
                    chain.joints[i + 1].position = (chain.joints[i].position + 
                                                   direction * chain.bone_lengths[i])
            
            # Check if we've converged
            end_effector_distance = np.linalg.norm(
                chain.joints[-1].position - target
            )
            
            if end_effector_distance < self.tolerance:
                break
        
        self.solve_time = time.perf_counter() - start_time
        return chain


class CCDSolver:
    """
    CCD (Cyclic Coordinate Descent) IK Solver
    
    Iteratively rotates each joint to bring end effector closer to target
    
    Time Complexity: O(n * iterations) where n is number of joints
    Space Complexity: O(1)
    """
    
    def __init__(self, tolerance: float = 0.01, max_iterations: int = 15):
        self.tolerance = tolerance
        self.max_iterations = max_iterations
        self.solve_time = 0.0
        
    def solve(self, chain: IKChain, target: np.ndarray,
              constraints: Optional[dict] = None) -> IKChain:
        """
        Solve IK using CCD algorithm
        
        Args:
            chain: The kinematic chain to solve
            target: Target position for end effector
            constraints: Optional joint constraints
            
        Returns:
            Solved IKChain with updated joint positions
        """
        start_time = time.perf_counter()
        
        for iteration in range(self.max_iterations):
            # Iterate from end effector backwards to root
            for i in range(len(chain.joints) - 2, -1, -1):
                end_effector = chain.joints[-1].position
                joint = chain.joints[i].position
                
                # Vectors from current joint to end effector and target
                to_end = end_effector - joint
                to_target = target - joint
                
                # Calculate rotation angle
                to_end_norm = np.linalg.norm(to_end)
                to_target_norm = np.linalg.norm(to_target)
                
                if to_end_norm < 1e-6 or to_target_norm < 1e-6:
                    continue
                
                # Normalize vectors
                to_end = to_end / to_end_norm
                to_target = to_target / to_target_norm
                
                # Calculate rotation angle using dot product
                cos_angle = np.clip(np.dot(to_end, to_target), -1.0, 1.0)
                angle = np.arccos(cos_angle)
                
                # Determine rotation direction (2D case)
                if len(joint) == 2:  # 2D
                    cross = to_end[0] * to_target[1] - to_end[1] * to_target[0]
                    if cross < 0:
                        angle = -angle
                
                # Rotate all joints after current joint
                if abs(angle) > 1e-6:
                    self._rotate_joints(chain, i, angle)
            
            # Check convergence
            end_effector_distance = np.linalg.norm(
                chain.joints[-1].position - target
            )
            
            if end_effector_distance < self.tolerance:
                break
        
        self.solve_time = time.perf_counter() - start_time
        return chain
    
    def _rotate_joints(self, chain: IKChain, pivot_index: int, angle: float):
        """Rotate joints around pivot joint (2D rotation)"""
        pivot = chain.joints[pivot_index].position
        cos_a = np.cos(angle)
        sin_a = np.sin(angle)
        
        rotation_matrix = np.array([
            [cos_a, -sin_a],
            [sin_a, cos_a]
        ])
        
        # Rotate all joints after the pivot
        for i in range(pivot_index + 1, len(chain.joints)):
            relative = chain.joints[i].position - pivot
            rotated = rotation_matrix @ relative[:2]  # 2D rotation
            
            if len(chain.joints[i].position) == 2:
                chain.joints[i].position = pivot + rotated
            else:  # 3D - keep z coordinate
                chain.joints[i].position[:2] = pivot[:2] + rotated
                

class PoleVectorConstraint:
    """
    Pole vector constraint for controlling joint orientation
    Commonly used to control elbow/knee bending direction
    """
    
    def __init__(self, pole_position: np.ndarray):
        self.pole_position = pole_position
        
    def apply(self, chain: IKChain, joint_index: int):
        """
        Apply pole vector constraint to specified joint (typically middle joint)
        
        Args:
            chain: The kinematic chain
            joint_index: Index of joint to constrain (usually middle of chain)
        """
        if joint_index <= 0 or joint_index >= len(chain.joints) - 1:
            return
        
        start = chain.joints[joint_index - 1].position
        end = chain.joints[joint_index + 1].position
        current = chain.joints[joint_index].position
        
        # Calculate midpoint between start and end
        mid = (start + end) / 2
        
        # Vector from mid to current joint
        to_current = current - mid
        to_current_dist = np.linalg.norm(to_current)
        
        # Vector from mid to pole
        to_pole = self.pole_position - mid
        to_pole_norm = to_pole / np.linalg.norm(to_pole)
        
        # Project current joint onto pole direction
        chain.joints[joint_index].position = mid + to_pole_norm * to_current_dist


def benchmark_solvers(num_trials: int = 100):
    """
    Benchmark FABRIK vs CCD performance
    
    Returns performance metrics for portfolio documentation
    """
    print("=== IK Solver Performance Benchmark ===\n")
    
    fabrik_times = []
    ccd_times = []
    
    fabrik_solver = FABRIKSolver(tolerance=0.01, max_iterations=10)
    ccd_solver = CCDSolver(tolerance=0.01, max_iterations=15)
    
    for _ in range(num_trials):
        # Create test chain (3-joint arm)
        joints = [
            Joint(np.array([0.0, 0.0])),
            Joint(np.array([1.0, 0.0])),
            Joint(np.array([2.0, 0.0]))
        ]
        chain1 = IKChain(joints)
        
        joints2 = [Joint(j.position.copy()) for j in joints]
        chain2 = IKChain(joints2)
        
        # Random target
        target = np.random.rand(2) * 2.0
        
        # Solve with both
        fabrik_solver.solve(chain1, target)
        ccd_solver.solve(chain2, target)
        
        fabrik_times.append(fabrik_solver.solve_time * 1000)  # Convert to ms
        ccd_times.append(ccd_solver.solve_time * 1000)
    
    print(f"FABRIK Average: {np.mean(fabrik_times):.3f}ms")
    print(f"FABRIK Std Dev: {np.std(fabrik_times):.3f}ms")
    print(f"FABRIK Min/Max: {np.min(fabrik_times):.3f}ms / {np.max(fabrik_times):.3f}ms\n")
    
    print(f"CCD Average: {np.mean(ccd_times):.3f}ms")
    print(f"CCD Std Dev: {np.std(ccd_times):.3f}ms")
    print(f"CCD Min/Max: {np.min(ccd_times):.3f}ms / {np.max(ccd_times):.3f}ms\n")
    
    print(f"FABRIK is {np.mean(ccd_times) / np.mean(fabrik_times):.2f}x faster")


if __name__ == "__main__":
    # Example usage
    print("Advanced IK Solvers - Disney TD Portfolio\n")
    
    # Create a simple 3-joint arm
    joints = [
        Joint(np.array([0.0, 0.0]), "shoulder"),
        Joint(np.array([1.0, 0.0]), "elbow"),
        Joint(np.array([2.0, 0.0]), "wrist")
    ]
    
    chain = IKChain(joints)
    
    # Target position
    target = np.array([1.5, 1.5])
    
    # Solve with FABRIK
    print("Solving with FABRIK...")
    solver = FABRIKSolver()
    solved_chain = solver.solve(chain, target)
    
    print(f"Solution found in {solver.solve_time * 1000:.3f}ms")
    print("\nJoint positions:")
    for joint in solved_chain.joints:
        print(f"  {joint.name}: {joint.position}")
    
    print("\n")
    benchmark_solvers()
