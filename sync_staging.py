#!/usr/bin/env python3
import subprocess
import sys
import time

def print_header(message):
    print(f"\n{'='*50}\n🚀 {message}\n{'='*50}")

def print_success(message):
    print(f"✅ {message}")

def print_error(message):
    print(f"❌ {message}")

def run_command(command, description):
    print(f"\n⏳ {description}...")
    try:
        # Ejecutamos el comando mostrando el output en tiempo real
        process = subprocess.Popen(
            command, 
            shell=True, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.STDOUT,
            universal_newlines=True
        )
        
        for line in process.stdout:
            print(f"   {line.strip()}")
            
        process.wait()
        
        if process.returncode == 0:
            print_success(f"{description} completado con éxito.")
            return True
        else:
            print_error(f"{description} falló con código {process.returncode}.")
            return False
            
    except Exception as e:
        print_error(f"Error al ejecutar {command}: {str(e)}")
        return False

def main():
    print_header("Sincronización de Datos: Producción ➡️  Staging Local")
    
    start_time = time.time()
    
    # 1. Exportar los datos desde producción
    # Usamos export_data.js porque maneja correctamente la conexión con el Pooler de Supabase
    # y formatea la data limpia para evitar conflictos con PostgreSQL 15 local.
    if not run_command("node --env-file=.env export_data.js", "Descargando datos desde producción"):
        sys.exit(1)
        
    # 2. Resetear la base de datos de staging
    # Esto limpiará la BD de staging local, aplicará las migraciones y cargará el nuevo seed.sql
    if not run_command("npm run staging:reset", "Aplicando datos al entorno Staging (Docker)"):
        sys.exit(1)
        
    elapsed = time.time() - start_time
    print_header(f"Sincronización completada en {elapsed:.1f} segundos. ¡Staging está actualizado! 🎉")

if __name__ == "__main__":
    main()
