#!/usr/bin/env python3
"""
Flow Executor - Rufler-inspired workflow executor for development tasks.

Procesa workflows declarativos en YAML y ejecuta tareas sin afectar runtime.
No es producción - solo desarrollo y validación.

Uso:
  python flow-executor.py workflows/validate-render.yml
  python flow-executor.py workflows/validate-qc.yml
  python flow-executor.py workflows/validate-3-videos.yml
"""

import sys
import os
import json
import yaml
import subprocess
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform.startswith("win") else 0


class FlowExecutor:
    """Ejecuta workflows declarativos en YAML."""

    def __init__(self, flow_file: str):
        self.flow_file = flow_file
        self.flow_dir = Path(flow_file).parent
        self.repo_root = Path(__file__).parent.parent.parent
        self.backend_root = self.repo_root / "backend"
        self.load_flow()

    def load_flow(self):
        """Carga el archivo YAML del workflow."""
        with open(self.flow_file, 'r') as f:
            self.flow = yaml.safe_load(f)

        self.name = self.flow.get('name', 'unnamed-flow')
        self.steps = self.flow.get('steps', [])
        self.outputs = {}
        self.start_time = None
        self.end_time = None

    def run(self) -> bool:
        """Ejecuta todos los pasos del workflow."""
        self.start_time = datetime.now()
        print(f"\n{'='*70}")
        print(f"[RUNNING] Ejecutando: {self.name}")
        print(f"{'='*70}\n")

        success = True
        for i, step in enumerate(self.steps, 1):
            step_name = step.get('name', f'step-{i}')
            step_type = step.get('type', 'exec')

            print(f"[{i}/{len(self.steps)}] {step_name} ({step_type})...")

            try:
                result = self.execute_step(step)
                if result:
                    print(f"[OK] {step_name}\n")
                else:
                    print(f"[FAIL] {step_name}\n")
                    if step.get('continue_on_error'):
                        print(f"  (continuar por continue_on_error=true)\n")
                        continue
                    success = False
                    break
            except Exception as e:
                print(f"[ERROR] {step_name}: {e}\n")
                if step.get('continue_on_error'):
                    continue
                success = False
                break

        self.end_time = datetime.now()
        duration = (self.end_time - self.start_time).total_seconds()

        print(f"{'='*70}")
        if success:
            print(f"[SUCCESS] Workflow completado en {duration:.2f}s")
        else:
            print(f"[FAILED] Workflow falló en {duration:.2f}s")
        print(f"{'='*70}\n")

        self.save_report()
        return success

    def execute_step(self, step: Dict[str, Any]) -> bool:
        """Ejecuta un paso individual."""
        step_type = step.get('type', 'exec')
        step_name = step.get('name', 'unnamed')

        if step_type == 'exec':
            return self.exec_command(step, step_name)
        elif step_type == 'script':
            return self.exec_script(step, step_name)
        elif step_type == 'validate':
            return self.validate_files(step, step_name)
        elif step_type == 'assert':
            return self.assert_condition(step, step_name)
        else:
            print(f"Tipo desconocido: {step_type}")
            return False

    def exec_command(self, step: Dict[str, Any], step_name: str) -> bool:
        """Ejecuta un comando shell."""
        cmd = step.get('command')
        if not cmd:
            return False

        # Expandir variables
        cmd = self.expand_vars(cmd)

        print(f"  > {cmd[:80]}{'...' if len(cmd) > 80 else ''}")

        try:
            result = subprocess.run(
                cmd,
                shell=True,
                cwd=str(self.backend_root),
                capture_output=True,
                text=True,
                timeout=120,
                creationflags=_NO_WINDOW,
            )

            if result.returncode == 0:
                if result.stdout:
                    # Guardar output
                    self.outputs[step_name] = result.stdout.strip()
                return True
            else:
                err_msg = result.stderr[:200] if result.stderr else "Exit code: " + str(result.returncode)
                print(f"    Error: {err_msg}")
                return False
        except subprocess.TimeoutExpired:
            print(f"    Error: Timeout (120s)")
            return False
        except Exception as e:
            print(f"    Error: {str(e)}")
            return False

    def exec_script(self, step: Dict[str, Any], step_name: str) -> bool:
        """Ejecuta un script Node.js o Python."""
        script = step.get('script')
        if not script:
            return False

        script_path = self.backend_root / script
        if not script_path.exists():
            print(f"    Error: Script no encontrado: {script}")
            return False

        ext = script_path.suffix
        if ext == '.js':
            cmd = f"node {script}"
        elif ext == '.py':
            cmd = f"python {script}"
        else:
            print(f"    Error: Extensión no soportada: {ext}")
            return False

        print(f"  > {cmd}")

        try:
            result = subprocess.run(
                cmd,
                shell=True,
                cwd=str(self.backend_root),
                capture_output=True,
                text=True,
                timeout=180,
                creationflags=_NO_WINDOW,
            )

            if result.returncode == 0:
                if result.stdout:
                    self.outputs[step_name] = result.stdout.strip()
                return True
            else:
                print(f"    Error: {result.stderr[:200]}")
                return False
        except subprocess.TimeoutExpired:
            print(f"    Error: Timeout (180s)")
            return False
        except Exception as e:
            print(f"    Error: {str(e)}")
            return False

    def validate_files(self, step: Dict[str, Any], step_name: str) -> bool:
        """Valida que archivos existan y cumplan condiciones."""
        files = step.get('files', [])
        all_exist = True

        for file_spec in files:
            if isinstance(file_spec, str):
                file_path = self.backend_root / file_spec
                exists = file_path.exists()
                status = "[+]" if exists else "[-]"
                print(f"    {status} {file_spec}")
                all_exist = all_exist and exists
            elif isinstance(file_spec, dict):
                file_path = self.backend_root / file_spec['path']
                exists = file_path.exists()

                if exists and 'min_size' in file_spec:
                    size = file_path.stat().st_size
                    size_ok = size >= file_spec['min_size']
                    if not size_ok:
                        print(f"    [-] {file_spec['path']} (size {size} < {file_spec['min_size']})")
                        all_exist = False
                    else:
                        print(f"    [+] {file_spec['path']} ({size} bytes)")
                else:
                    status = "[+]" if exists else "[-]"
                    print(f"    {status} {file_spec['path']}")
                    all_exist = all_exist and exists

        return all_exist

    def assert_condition(self, step: Dict[str, Any], step_name: str) -> bool:
        """Valida condiciones lógicas."""
        condition = step.get('condition')
        if not condition:
            return False

        # Condiciones simples: "file-exists:path/to/file" o "cmd-exit-0:command"
        if ':' in condition:
            cond_type, cond_value = condition.split(':', 1)

            if cond_type == 'file-exists':
                exists = (self.backend_root / cond_value).exists()
                print(f"    {cond_value}: {'[OK]' if exists else '[FAIL]'}")
                return exists

            elif cond_type == 'cmd-exit-0':
                result = subprocess.run(
                    cond_value,
                    shell=True,
                    cwd=str(self.backend_root),
                    capture_output=True
                )
                ok = result.returncode == 0
                print(f"    {cond_value}: {'[OK]' if ok else '[FAIL]'}")
                return ok

        return False

    def expand_vars(self, text: str) -> str:
        """Expande variables: {repo_root}, {backend_root}, {output:step_name}."""
        text = text.replace('{repo_root}', str(self.repo_root))
        text = text.replace('{backend_root}', str(self.backend_root))

        # Expandir outputs previos
        for key, value in self.outputs.items():
            text = text.replace(f'{{output:{key}}}', value)

        return text

    def save_report(self):
        """Guarda un reporte del workflow."""
        report = {
            'flow': self.name,
            'file': self.flow_file,
            'start_time': self.start_time.isoformat(),
            'end_time': self.end_time.isoformat(),
            'duration_seconds': (self.end_time - self.start_time).total_seconds(),
            'steps': len(self.steps),
            'outputs': self.outputs,
        }

        report_file = Path(self.flow_file).with_suffix('.report.json')
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)

        print(f"Reporte guardado: {report_file}\n")


def main():
    if len(sys.argv) < 2:
        print("""
Uso: python flow-executor.py <workflow-file.yml>

Ejemplos:
  python flow-executor.py workflows/validate-render.yml
  python flow-executor.py workflows/validate-qc.yml
  python flow-executor.py workflows/validate-3-videos.yml
  python flow-executor.py workflows/debug-stuck-queue.yml
  python flow-executor.py workflows/audit-prepublish.yml
""")
        sys.exit(1)

    flow_file = sys.argv[1]
    if not Path(flow_file).exists():
        print(f"Error: Archivo no encontrado: {flow_file}")
        sys.exit(1)

    executor = FlowExecutor(flow_file)
    success = executor.run()

    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
