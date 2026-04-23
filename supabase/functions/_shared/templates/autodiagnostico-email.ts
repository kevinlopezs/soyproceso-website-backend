export const autodiagnosticoTemplate = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800&family=Nunito+Sans:wght@400;600&display=swap');
        
        body {
            font-family: 'Nunito Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background-color: #EAF5F2;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
        }
        .wrapper {
            width: 100%;
            table-layout: fixed;
            background-color: #EAF5F2;
            padding-bottom: 40px;
            padding-top: 40px;
        }
        .main {
            background-color: #ffffff;
            margin: 0 auto;
            width: 100%;
            max-width: 600px;
            border-spacing: 0;
            font-family: 'Nunito Sans', sans-serif;
            color: #1C4A42;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(45, 122, 110, 0.08);
        }
        .header {
            background-color: #2D7A6E;
            padding: 40px 30px;
            text-align: center;
        }
        .logo-container {
            margin-bottom: 20px;
        }
        .logo {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            border: 3px solid rgba(232, 201, 122, 0.3);
        }
        .header-title {
            font-family: 'Nunito', sans-serif;
            color: #E8C97A;
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 1px;
            margin: 0;
            text-transform: uppercase;
        }
        .header-subtitle {
            color: #ffffff;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-top: 5px;
            opacity: 0.8;
        }
        .banner {
            background-color: #ffffff;
            padding: 40px 40px 20px 40px;
            text-align: center;
        }
        .banner-icon {
            font-size: 40px;
            margin-bottom: 20px;
        }
        h1 {
            font-family: 'Nunito', sans-serif;
            font-size: 28px;
            font-weight: 800;
            line-height: 1.2;
            margin: 0 0 15px 0;
            color: #1C4A42;
        }
        .body-text {
            font-size: 16px;
            line-height: 1.6;
            color: #5A8A82;
            margin-bottom: 30px;
            padding: 0 40px;
            text-align: center;
        }
        .cta-section {
            padding: 0 40px 40px 40px;
            text-align: center;
        }
        .btn {
            display: inline-block;
            background-color: #2D7A6E;
            color: #ffffff !important;
            text-decoration: none;
            padding: 18px 36px;
            border-radius: 50px;
            font-weight: 700;
            font-size: 16px;
            border: none;
            box-shadow: 0 8px 20px rgba(45, 122, 110, 0.25);
            transition: all 0.3s ease;
        }
        .info-card {
            background-color: #FDF5DC;
            border-left: 4px solid #E8C97A;
            margin: 20px 40px;
            padding: 20px;
            border-radius: 0 16px 16px 0;
            text-align: left;
        }
        .info-card-text {
            font-size: 13px;
            color: #8A6800;
            line-height: 1.5;
            margin: 0;
        }
        .contact-box {
            background-color: #F8FCFB;
            border: 1px solid #EAF5F2;
            border-radius: 20px;
            margin: 40px;
            padding: 30px;
            text-align: center;
        }
        .contact-title {
            font-size: 14px;
            font-weight: 700;
            color: #1C4A42;
            margin-bottom: 15px;
        }
        .wa-btn {
            display: inline-block;
            background-color: #25D366;
            color: #ffffff !important;
            text-decoration: none;
            padding: 12px 24px;
            border-radius: 50px;
            font-weight: 700;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(37, 211, 102, 0.2);
        }
        .footer {
            padding: 30px;
            text-align: center;
            background-color: #F8FCFB;
        }
        .footer-text {
            font-size: 12px;
            color: #9ABCB6;
            margin: 0;
            letter-spacing: 0.5px;
        }
        @media screen and (max-width: 600px) {
            .main {
                border-radius: 0;
            }
            .body-text, .cta-section, .info-card, .contact-box {
                margin-left: 20px;
                margin-right: 20px;
                padding-left: 20px;
                padding-right: 20px;
            }
            h1 {
                font-size: 24px;
            }
        }
    </style>
</head>
<body>
    <div class="wrapper">
        <table class="main">
            <tr>
                <td class="header">
                    <div class="logo-container">
                        <img src="https://soyproceso.b-cdn.net/FONDO-CIRCULAR.png" alt="SoyProceso" class="logo">
                    </div>
                    <p class="header-title">SOY PROCESO</p>
                    <p class="header-subtitle">Salud Mental & SST</p>
                </td>
            </tr>
            <tr>
                <td class="banner">
                    <div class="banner-icon">📋</div>
                    <h1>Tu Autodiagnóstico está listo</h1>
                </td>
            </tr>
            <tr>
                <td class="body-text">
                    Gracias por confiar en <strong>Soy Proceso</strong>. Hemos analizado tu perfil de riesgo psicosocial según la Resolución 2764 de 2022 y hemos preparado tu reporte detallado.
                </td>
            </tr>
            <tr>
                <td class="cta-section">
                    <a href="{{pdf_download_link}}" class="btn">Descargar reporte PDF</a>
                </td>
            </tr>
            <tr>
                <td>
                    <div class="info-card">
                        <p class="info-card-text">
                            <strong>Nota importante:</strong> Este documento es una herramienta preventiva. Recuerda que el cumplimiento normativo es vital para evitar sanciones y proteger la salud de tus colaboradores.
                        </p>
                    </div>
                </td>
            </tr>
            <tr>
                <td>
                    <div class="contact-box">
                        <p class="contact-title">¿Necesitas ayuda con el plan de intervención?</p>
                        <a href="https://wa.me/573186392462" class="wa-btn">Hablar con un experto</a>
                    </div>
                </td>
            </tr>
            <tr>
                <td class="footer">
                    <p class="footer-text">© 2026 SoyProceso · Bogotá, Colombia</p>
                    <p class="footer-text" style="margin-top: 5px;">Tu aliado en Bienestar Laboral</p>
                </td>
            </tr>
        </table>
    </div>
</body>
</html>
`;
