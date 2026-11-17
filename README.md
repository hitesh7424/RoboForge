# RoboForge

Browser-based drag-and-drop ROS 2 robot and Gazebo world builder that exports a complete, ready-to-build ROS 2 package.

## Supported Targets

- **ROS 2 Jazzy + Gazebo Harmonic** (`gz-sim`, `ros_gz_sim`, `ros_gz_bridge`, SDF `1.10`)
- **ROS 2 Humble + Gazebo Fortress** (`ign gazebo`, `ros_ign_gazebo`, `ros_ign_bridge`, SDF `1.9`)
- **ROS 2 Lyrical + Gazebo Jetty** (`gz-sim`, `ros_gz_sim`, `ros_gz_bridge`, SDF `1.11`)

## Features

- **3D Robot Editor**: Drag-and-drop links (`box`, `cylinder`, `sphere`, `capsule`), named mounting points, joints (`fixed`, `revolute`, `continuous`, `prismatic`), gizmo transforms (`W` move, `E` rotate, `R` scale) with snapping, Visual / Collision / Inertial overlays, mirror across Y, and drag-to-reparent hierarchy.
- **Sensors & Actuators**: 2D/3D LiDAR, RGB/Depth Camera, IMU, GPS/NavSat, Differential Drive, Ackermann Steering, Joint State Publisher, and Joint Position Controller plugins with `ros_gz_bridge` YAML generation.
- **3D Gazebo World Builder**: 3D Perspective and Top-Down Plan views for placing static/dynamic obstacles, Fuel `model://` references, lights, physics step/RTF/gravity, ground plane settings, and robot spawn pose.
- **Custom Part Editor**:
  1. Parametric **Chassis with Axles** & compound primitive assemblies preserving mount IDs
  2. 2D XY **Sketch & Extrude** + live **CSG Boolean** (`add`/`subtract` via `three-bvh-csg`)
  3. **Mesh Import** (`.stl`, `.glb`, `.dae`) to replace link visuals without altering collision/inertial, with mount bounding-box compatibility checks
- **Live URDF Round-Trip Preview**: Parses generated URDF with `urdf-loader`, verifies link/joint/mass counts, and provides interactive joint sliders.
- **ROS 2 Package Export**: Monaco code preview + `.zip` download (`package.xml`, `CMakeLists.txt`, `urdf/*.xacro`, `sdf/*.sdf`, `worlds/*.sdf`, `launch/sim.launch.py`, `launch/display.launch.py`, `config/bridge.yaml`, `config/robot.rviz`, `meshes/*`).

## Development & Verification

```bash
npm install
npm test
npm run lint
npm run build
```

## Validating Exported ROS 2 Packages Locally

```bash
unzip <package_name>.zip -d ~/ros2_ws/src
cd ~/ros2_ws && colcon build --packages-select <package_name>
source install/setup.bash
xacro src/<package_name>/urdf/<robot>.urdf.xacro > /tmp/resolved.urdf
check_urdf /tmp/resolved.urdf
gz sdf -k src/<package_name>/worlds/<world>.sdf
ros2 launch <package_name> sim.launch.py
```
