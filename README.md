## Installation & Setup

### Prerequisites

- Node.js and npm
- Python 3.10+
- GCC/G++ with C++17 support
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/RouteIQ.git
cd RouteIQ
```

### 2. Backend Setup (Windows)

Open a terminal in the project root (`routeiq`).

Navigate to the backend directory:

```powershell
cd backend
```

Create and activate a virtual environment:

```powershell
python -m venv venv
.\venv\Scripts\Activate
```

Install the dependencies:

```powershell
pip install -r requirements.txt
```

Compile the C++ optimization engine (requires GCC/G++ via MinGW or MSYS2):

```powershell
g++ -std=c++17 -O2 algorithm.cpp -o algorithm.exe
```

Start the FastAPI backend:

```powershell
python -m uvicorn main:app --reload
```

The backend will run at:

- API: `http://localhost:8000`
- API Documentation: `http://localhost:8000/docs`

**Note:** Keep this terminal open while running RouteIQ.


### 3. Frontend Setup

Open a **new terminal** in the project root (`routeiq`).

Install the dependencies:

```bash
npm install
```

Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Start the frontend:

```bash
npm run dev
```

Frontend: `http://localhost:3000`

### 4. Run RouteIQ

Keep both terminals running simultaneously.

Open `http://localhost:3000` in your browser to access the RouteIQ dashboard.

