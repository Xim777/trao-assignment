"use client";

import { useEffect, useState } from "react";

export default function Home() {

  const [status, setStatus] = useState(
    "Checking backend..."
  );

  useEffect(() => {

    const API_URL =
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:4000";

    fetch(`${API_URL}/health`)

      .then(response => {

        if (!response.ok) {
          throw new Error("Backend unavailable");
        }

        return response.json();

      })

      .then(data => {

        setStatus(
          data.status === "ok"
            ? "Backend connected"
            : "Unexpected response"
        );

      })

      .catch(() => {

        setStatus("Backend unavailable");

      });

  }, []);


  return (

    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">

      <h1 className="text-3xl font-bold">
        AI Interview Prep Kit
      </h1>

      <p className="text-gray-500">
        Your personalized interview preparation platform.
      </p>

      <div className="rounded-lg border px-6 py-4">

        <p className="font-medium">
          API Status
        </p>

        <p className="text-sm text-gray-500">
          {status}
        </p>

      </div>

    </main>

  );

}
