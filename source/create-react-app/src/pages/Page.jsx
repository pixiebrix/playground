
import React, {useEffect} from "react";

const Page = ({title, children}) => {

  useEffect(() => {
    document.title = `${title} - PixieBrix Sandbox`;
  }, [title]);

  return (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

export default Page;