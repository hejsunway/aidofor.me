import Image from "next/image";

const universities = [
  { name: "Monash University", src: "/universities/monash-university.svg" },
  { name: "Universiti Kebangsaan Malaysia", src: "/universities/ukm.png" },
  { name: "Universiti Malaya", src: "/universities/universiti-malaya.webp" },
  { name: "Universiti Sains Malaysia", src: "/universities/universiti-sains-malaysia.png" },
  { name: "Tunku Abdul Rahman University of Management and Technology", src: "/universities/tar-umt.png" },
  { name: "SEGi University", src: "/universities/segi-university.png" },
  { name: "INTI International University and Colleges", src: "/universities/inti.png" },
  { name: "Universiti Tunku Abdul Rahman", src: "/universities/utar.jpg" },
  { name: "Taylor's University", src: "/universities/taylors-university.webp" },
  { name: "Sunway University", src: "/universities/sunway-university.png" },
];

function UniversityLogoGroup({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <div
      aria-hidden={duplicate ? "true" : undefined}
      className={`university-trust__group${duplicate ? " university-trust__group--duplicate" : ""}`}
    >
      {universities.map(({ name, src }) => (
        <div className="university-trust__logo" key={`${duplicate ? "duplicate-" : ""}${name}`}>
          <Image
            alt={duplicate ? "" : `${name} logo`}
            fill
            sizes="190px"
            src={src}
          />
        </div>
      ))}
    </div>
  );
}

export function UniversityTrust() {
  return (
    <section className="university-trust" aria-labelledby="university-trust-title">
      <div className="container">
        <h2 id="university-trust-title">Trusted by students from universities:</h2>
      </div>
      <div className="university-trust__viewport">
        <div className="university-trust__track">
          <UniversityLogoGroup />
          <UniversityLogoGroup duplicate />
        </div>
      </div>
    </section>
  );
}
